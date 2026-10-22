import { loadEnvConfig } from '@next/env';
import { getPgPool, pgTransaction, databaseError } from '../lib/postgres';
loadEnvConfig(process.cwd());
async function main() {
  await pgTransaction(async client => {
    await client.query('ALTER TABLE productos ALTER COLUMN stock_minimo SET DEFAULT 1');
    const updated = await client.query('UPDATE productos SET stock_minimo=1 WHERE stock_minimo<>1 RETURNING id_producto');
    if (updated.rowCount) await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
    const check = await client.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE stock_minimo=1)::int AS correctos FROM productos');
    console.log(`Mínimo de mostrador en 1 unidad: ${check.rows[0].correctos}/${check.rows[0].total} productos.`);
  });
}
main().catch(error => { console.error(databaseError(error).message); process.exitCode=1; }).finally(async () => { try { await getPgPool().end(); } catch {} });
