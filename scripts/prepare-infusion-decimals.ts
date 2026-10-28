import { loadEnvConfig } from '@next/env';
import { Pool, type PoolClient } from 'pg';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectionConfig } from '../lib/connection-config';
import { inventorySnapshot, verifyInventorySnapshot } from '../lib/migration';

loadEnvConfig(process.cwd());

async function prepared(client: PoolClient): Promise<boolean> {
  const columns = await client.query(`SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema='public' AND data_type='numeric' AND numeric_precision IS NULL AND
    ((table_name='insumos' AND column_name IN ('stock','stock_minimo')) OR
     (table_name='movimientos_insumos' AND column_name IN ('cantidad','stock_anterior','stock_posterior')))`);
  const constraints = await client.query(`SELECT count(*)::int AS count FROM pg_constraint
    WHERE convalidated AND contype='c' AND
    ((conrelid=to_regclass('public.insumos') AND conname IN ('insumos_stock_precision','insumos_stock_minimo_precision')) OR
     (conrelid=to_regclass('public.movimientos_insumos') AND conname='movimientos_insumos_precision'))`);
  return columns.rows[0].count === 5 && constraints.rows[0].count === 3;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Modo inválido.');
  const apply = args[0] === '--apply';
  const target = process.env.INVENTORY_STORAGE === 'supabase' ? 'supabase' : 'local';
  if (apply && target === 'supabase' && !process.env.SUPABASE_ADMIN_DATABASE_URL) throw new Error('Falta la conexión administrativa.');
  const env = target === 'supabase' && process.env.SUPABASE_ADMIN_DATABASE_URL
    ? { ...process.env, SUPABASE_DATABASE_URL: process.env.SUPABASE_ADMIN_DATABASE_URL } : process.env;
  const pool = new Pool(connectionConfig(env, target));
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    if (apply) {
      await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
      await client.query('LOCK TABLE public.insumos,public.movimientos_insumos IN ACCESS EXCLUSIVE MODE');
      const before = await inventorySnapshot(client);
      await mkdir('data/backups', { recursive: true });
      await writeFile(`data/backups/antes-decimales-infusiones-${Date.now()}.json`, JSON.stringify(before), { flag: 'wx', mode: 0o600 });
      await client.query(await readFile('database/018_infusiones_decimales.sql', 'utf8'));
      await verifyInventorySnapshot(client, before);
    }
    const ready = await prepared(client);
    if (apply && !ready) throw new Error('El esquema no quedó preparado.');
    await client.query('COMMIT');
    console.log(JSON.stringify({ prepared: ready, decimalPlaces: 2, scope: 'Seis infusiones por bolsa', mode: apply ? 'apply' : 'check' }));
    if (apply) console.log('Decimales preparados. Cantidades, mínimos e historial conservados; copia privada guardada.');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('No se completó la preparación de decimales. Las escrituras sin confirmar se revirtieron; no se imprimen credenciales.');
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,60}$/.test(code)) console.error(`Código de diagnóstico: ${code}`);
  process.exitCode = 1;
});
