import { loadEnvConfig } from '@next/env';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPgPool, databaseError, pgTransaction } from '../lib/postgres';
import { seed } from '../lib/inventory';
import { seedSupplies } from '../lib/supplies-store';

loadEnvConfig(process.cwd());
const expected: Record<string, string[]> = {
  usuarios: ['id_usuario', 'nombre_usuario', 'email', 'password_hash', 'rol', 'activo'],
  categorias: ['id_categoria', 'nombre_categoria'],
  productos: ['id_producto', 'id_categoria', 'nombre_producto', 'rendimiento', 'stock_minimo', 'activo'],
  ubicaciones: ['id_ubicacion', 'nombre_ubicacion', 'tipo'],
  lotes: ['id_lote', 'id_producto', 'codigo', 'fecha_produccion', 'rendimiento', 'creado_por', 'observaciones'],
  turnos: ['id_turno', 'fecha', 'periodo', 'id_responsable', 'estado', 'abierto_en', 'cerrado_en'],
  detalle_turno: ['id_detalle_turno', 'id_turno', 'id_producto', 'entrada', 'conteo_cierre'],
  movimiento_inventario: ['id_movimiento_inventario', 'id_producto', 'id_lote', 'id_ubicacion', 'id_turno', 'tipo', 'sentido', 'cantidad', 'unidad', 'id_operacion', 'id_usuario', 'motivo', 'creado_en'],
};
async function main() {
  const mode = process.argv[2];
  if (!['check', 'setup', 'units', 'beta2', 'features'].includes(mode)) throw new Error('Usa db:check, db:setup, db:units, db:beta2 o db:features.');
  const pool = getPgPool();
  const identity = await pool.query('SELECT current_database() AS db, current_user AS usuario, inet_server_port() AS puerto');
  console.log(`Conexión correcta: ${identity.rows[0].db} · ${identity.rows[0].usuario} · puerto ${identity.rows[0].puerto}`);
  const columns = await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`);
  const missing = Object.entries(expected).flatMap(([table, names]) => names.filter(name => !columns.rows.some(c => c.table_name === table && c.column_name === name)).map(name => `${table}.${name}`));
  if (missing.length) throw new Error(`El esquema no coincide con database/schema.sql. Faltan: ${missing.join(', ')}. No se modificaron las tablas.`);
  for (const column of columns.rows) {
    if (['activo'].includes(column.column_name) && column.data_type !== 'boolean') throw new Error(`${column.table_name}.${column.column_name} debe ser BOOLEAN.`);
    if (expected[column.table_name] && ['rendimiento', 'stock_minimo', 'entrada', 'conteo_cierre', 'cantidad'].includes(column.column_name) && column.data_type !== 'integer') throw new Error(`${column.table_name}.${column.column_name} debe ser INTEGER, como en database/schema.sql.`);
  }
  console.log('Las ocho tablas tienen las columnas esperadas.');
  if (mode === 'features') {
    await pgTransaction(async client=>{
      await client.query(await readFile(path.join(process.cwd(),'database','007_alertas_excel.sql'),'utf8'));
      await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
    });
    console.log('Alertas e importaciones Excel preparadas. Los saldos y turnos existentes se conservan.');
    return;
  }
  if (mode === 'beta2') {
    await pgTransaction(async client => {
      await client.query(await readFile(path.join(process.cwd(), 'database', '005_insumos.sql'), 'utf8'));
      await client.query(await readFile(path.join(process.cwd(), 'database', '018_infusiones_decimales.sql'), 'utf8'));
      await client.query(await readFile(path.join(process.cwd(), 'database', '007_alertas_excel.sql'), 'utf8'));
      await client.query(await readFile('database/019_horneados.sql','utf8'));
      await client.query("INSERT INTO ubicaciones(nombre_ubicacion,tipo) SELECT 'Horneados en cocina','horneados' WHERE NOT EXISTS(SELECT 1 FROM ubicaciones WHERE tipo='horneados')");
      await seedSupplies(client);
      await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
    });
    console.log('Beta 0.2 preparada: catálogo de insumos sin cantidades inventadas. Se conservan los postres, lotes y turnos.');
    return;
  }
  if (mode === 'units') {
    await pgTransaction(async client => {
      await client.query(await readFile(path.join(process.cwd(), 'database', '003_unidades.sql'), 'utf8'));
    });
    console.log('Catálogo actualizado a unidades. Se conservan las cantidades de los lotes, cierres y movimientos anteriores.');
    return;
  }
  const control = await pool.query(`SELECT to_regclass('public.inventario_control') IS NOT NULL AS preparado`);
  if (mode === 'check') {
    console.log(control.rows[0].preparado ? 'Control de revisiones disponible.' : 'Falta preparar el control de revisiones: ejecuta npm run db:setup.');
    return;
  }
  await pgTransaction(async client => {
    await client.query(await readFile(path.join(process.cwd(), 'database', '002_control.sql'), 'utf8'));
    for (const category of ['Postres', 'Bollería']) await client.query('INSERT INTO categorias (nombre_categoria) VALUES ($1) ON CONFLICT (nombre_categoria) DO NOTHING', [category]);
    for (const [name, type] of [['Congelador', 'congelador'], ['Mostrador', 'mostrador']]) {
      const existing = await client.query('SELECT id_ubicacion FROM ubicaciones WHERE tipo=$1', [type]);
      if (!existing.rowCount) await client.query('INSERT INTO ubicaciones (nombre_ubicacion,tipo) VALUES ($1,$2)', [name, type]);
      else if (existing.rowCount > 1) throw new Error(`Hay varias ubicaciones de tipo ${type}. Esta beta admite una por tipo.`);
    }
    const count = await client.query('SELECT COUNT(*)::int AS n FROM productos');
    if (count.rows[0].n === 0) {
      for (const product of seed().products) await client.query(`INSERT INTO productos (id_categoria,nombre_producto,rendimiento,stock_minimo,activo)
        SELECT id_categoria,$1,$2,$3,true FROM categorias WHERE nombre_categoria=$4`, [product.name, product.yield, product.minimum, product.category]);
      console.log('Catálogo inicial cargado: 17 postres y 4 productos de viennoiserie, contados por unidades.');
    } else console.log('Se conserva el catálogo existente. No se reemplazan productos ni datos de operación.');
  });
  console.log('Preparación completada. Configura INVENTORY_STORAGE=postgres en .env.local y reinicia la aplicación.');
  console.log('Los datos del archivo JSON no se importan automáticamente.');
}
main().catch(error => { console.error(databaseError(error).message); process.exitCode = 1; }).finally(async () => { await getPgPoolSafely(); });
async function getPgPoolSafely() { try { await getPgPool().end(); } catch { /* No se creó un pool si faltaban credenciales. */ } }
