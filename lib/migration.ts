import type { PoolClient } from 'pg';
export const INVENTORY_TABLES = ['usuarios','categorias','productos','ubicaciones','lotes','turnos','detalle_turno','movimiento_inventario','inventario_control','insumos','movimientos_insumos','importaciones_excel'] as const;
export type InventorySnapshot = Record<typeof INVENTORY_TABLES[number], Record<string, unknown>[]>;
export async function inventorySnapshot(client: PoolClient): Promise<InventorySnapshot> {
  const timezone=(await client.query("SELECT current_setting('TimeZone') AS timezone")).rows[0].timezone;
  await client.query("SELECT set_config('TimeZone','UTC',false)");
  try{
  const snapshot = {} as InventorySnapshot;
  for (const table of INVENTORY_TABLES) {
    // to_jsonb preserva las fechas DATE como texto, sin reinterpretar zona horaria.
    const rows = await client.query(`SELECT to_jsonb(t) AS dato FROM "${table}" t`);
    snapshot[table] = rows.rows.map(r => r.dato);
  }
  return snapshot;
  }finally{await client.query("SELECT set_config('TimeZone',$1,false)",[timezone]).catch(()=>{});}
}
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export async function verifyInventorySnapshot(client:PoolClient,snapshot:InventorySnapshot){
  const copied=await inventorySnapshot(client);
  const rows=(value:unknown[])=>value.map(row=>JSON.stringify(canonical(row))).sort();
  for(const table of INVENTORY_TABLES){
    if(JSON.stringify(rows(snapshot[table]))!==JSON.stringify(rows(copied[table])))throw new Error(`El contenido copiado de ${table} no coincide. Se cancela la migración.`);
  }
}
export async function insertInventorySnapshot(client: PoolClient, snapshot: InventorySnapshot) {
  for (const table of INVENTORY_TABLES) {
    for (const row of snapshot[table]) {
      if (table === 'inventario_control') {
        await client.query('UPDATE inventario_control SET revision=$1 WHERE id=1', [row.revision]);
        continue;
      }
      const columns = Object.keys(row);
      // Columnas solo del esquema del servidor, nunca de una petición del navegador.
      if (columns.some(c => !/^[a-z_]+$/.test(c))) throw new Error('Columna inesperada en la copia.');
      await client.query(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_,i) => `$${i+1}`).join(',')})`, columns.map(c => table==='importaciones_excel'&&c==='registros'?JSON.stringify(row[c]):row[c]));
    }
  }
  const keys: Record<string, string> = { usuarios: 'id_usuario', categorias: 'id_categoria', productos: 'id_producto', ubicaciones: 'id_ubicacion', lotes: 'id_lote', turnos: 'id_turno', detalle_turno: 'id_detalle_turno', movimiento_inventario: 'id_movimiento_inventario', movimientos_insumos: 'orden' };
  for (const [table,key] of Object.entries(keys)) await client.query(`SELECT setval(pg_get_serial_sequence($1,$2),GREATEST(COALESCE(MAX("${key}"),0),1),MAX("${key}") IS NOT NULL) FROM "${table}"`, [table,key]);
  for (const table of INVENTORY_TABLES) {
    const count = await client.query(`SELECT COUNT(*)::int AS cantidad FROM "${table}"`);
    if (count.rows[0].cantidad !== snapshot[table].length) throw new Error(`No coincide la cantidad de registros en ${table}. Se cancela la copia.`);
  }
}
