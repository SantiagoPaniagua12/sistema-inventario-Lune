import { loadEnvConfig } from '@next/env';
import { Pool, type PoolClient } from 'pg';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES, inventorySnapshot, insertInventorySnapshot, verifyInventorySnapshot } from '../lib/migration';
loadEnvConfig(process.cwd());
async function main() {
  const mode = process.argv[2];
  if (!['check','migrate'].includes(mode)) throw new Error('Usa npm run supabase:check o npm run supabase:migrate.');
  const remote = new Pool(connectionConfig(process.env, 'supabase'));
  let local: Pool | undefined;
  try {
    await remote.query('SELECT 1');
    const roles = await remote.query(`SELECT COUNT(*)::int AS n FROM pg_roles WHERE rolname IN ('anon','authenticated')`);
    if (roles.rows[0].n !== 2) throw new Error('El destino no parece un proyecto Supabase. Revisa la conexión.');
    console.log('Conexión TLS a Supabase verificada. No se imprimen credenciales.');
    if (mode === 'check') return;
    try{await access(path.join(process.cwd(),'data','migration-maintenance.json'));}
    catch{throw new Error('Activa la pausa de registros (data/migration-maintenance.json) y comprueba que la API rechace escrituras antes de migrar.');}
    local = new Pool(connectionConfig(process.env, 'local'));
    const source = await local.connect();
    let destination: PoolClient | undefined;
    try {
      destination = await remote.connect();
      // Drain earlier writes before taking the repeatable-read snapshot.
      await source.query('SELECT pg_advisory_lock(20261018,5433)');
      await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await inventorySnapshot(source);
      await source.query('COMMIT');
      await mkdir(path.join(process.cwd(),'data','migrations'), { recursive: true });
      const backup = path.join(process.cwd(),'data','migrations',`pre-supabase-${Date.now()}.json`);
      await writeFile(backup, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
      console.log('Respaldo local creado en data/migrations. Contiene datos privados; no subirlo al repositorio.');
      await destination.query('BEGIN');
      await destination.query('SELECT pg_advisory_xact_lock(20261018,5433)');
      const existing = await destination.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1)`, [INVENTORY_TABLES]);
      if (existing.rowCount) throw new Error('El proyecto destino ya tiene tablas de inventario. La migración no reemplaza ni borra datos; utiliza un proyecto vacío.');
      const sql = await readFile(path.join(process.cwd(),'database','schema.sql'),'utf8');
      await destination.query(sql.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''));
      for (const file of ['002_control.sql','005_insumos.sql','007_alertas_excel.sql','012_operacion_simple.sql','013_borradores.sql','018_infusiones_decimales.sql','019_horneados.sql']) await destination.query(await readFile(path.join(process.cwd(),'database',file),'utf8'));
      await insertInventorySnapshot(destination, snapshot);
      await verifyInventorySnapshot(destination,snapshot);
      await destination.query(await readFile(path.join(process.cwd(),'database','006_supabase_security.sql'),'utf8'));
      await destination.query('COMMIT');
      console.log(`Copia completada: conteos y contenido de las ${INVENTORY_TABLES.length} tablas verificados. PostgreSQL local permanece intacto.`);
      console.log('Selecciona INVENTORY_STORAGE=supabase y verifica la aplicación antes de retirar la pausa de registros.');
    } catch (error) {
      await source.query('ROLLBACK').catch(() => {}); await destination?.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { await source.query('SELECT pg_advisory_unlock(20261018,5433)').catch(()=>{});source.release(); destination?.release(); }
  } finally { await local?.end(); await remote.end(); }
}
main().catch(error => {
  // Las URI y mensajes del driver pueden contener datos de conexión; no imprimirlos.
  if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error?.code)){
    console.error('No se pudo verificar el certificado TLS. Descarga el certificado CA desde Supabase > Database Settings > SSL Configuration y configura SUPABASE_SSL_CA_FILE en .env.local.');process.exitCode=1;return;
  }
  const safe = error instanceof Error && !('code' in error) && !/postgres(?:ql)?:\/\//.test(error.message) ? error.message : 'No se pudo completar la conexión o migración. Revisa las credenciales y que las tablas locales estén preparadas con npm run db:beta2.';
  console.error(safe); process.exitCode = 1;
});
