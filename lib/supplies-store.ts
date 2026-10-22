import type { PoolClient } from 'pg';
import { initialSupplies, type Supply, type SupplyMovement } from './supplies';
import type { Command, State } from './inventory';

export async function readSupplies(client: PoolClient): Promise<{ supplies: Supply[]; supplyMovements: SupplyMovement[] }> {
  const ready = await client.query(`SELECT to_regclass('insumos') IS NOT NULL AS ready`);
  if (!ready.rows[0].ready) return { supplies: [], supplyMovements: [] };
  const items = await client.query('SELECT * FROM insumos ORDER BY categoria,nombre');
  const history = await client.query('SELECT * FROM movimientos_insumos ORDER BY orden DESC');
  return {
    supplies: items.rows.map(i => ({ id: i.id_insumo, name: i.nombre, group: i.categoria, unit: i.unidad, minimum: i.stock_minimo, stock: i.stock, capacityMl: i.capacidad_ml, packSize: i.unidades_por_paquete, note: i.observaciones, estimated: i.estimado })),
    supplyMovements: history.rows.map(m => ({ id: m.id_movimiento, supplyId: m.id_insumo, action: m.tipo, quantity: m.cantidad, before: m.stock_anterior, after: m.stock_posterior, responsible: m.responsable, note: m.motivo, estimated: m.estimado, at: new Date(m.creado_en).toISOString() })),
  };
}
async function insertSupply(client: PoolClient, item: Supply, seed = false) {
  await client.query(`INSERT INTO insumos (id_insumo,nombre,categoria,unidad,stock,stock_minimo,capacidad_ml,unidades_por_paquete,observaciones,estimado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ${seed ? 'ON CONFLICT DO NOTHING' : ''}`, [item.id, item.name, item.group, item.unit, item.stock, item.minimum, item.capacityMl, item.packSize, item.note, item.estimated]);
}
export async function seedSupplies(client: PoolClient) {
  for (const item of initialSupplies()) await insertSupply(client, item, true);
}
export async function persistSupplyCommand(client: PoolClient, before: State, after: State, command: Command) {
  if (command.type === 'supplyCreate') {
    const added = after.supplies!.find(i => !before.supplies?.some(x => x.id === i.id));
    if (!added) throw new Error('No se encontró el nuevo insumo.');
    await insertSupply(client, added);
    return;
  }
  const item = after.supplies!.find(i => i.id === command.supplyId)!;
  const updated = await client.query(`UPDATE insumos SET nombre=$1,stock=$2,stock_minimo=$3,observaciones=$4,estimado=$5 WHERE id_insumo=$6`, [item.name, item.stock, item.minimum, item.note, item.estimated, item.id]);
  if (updated.rowCount !== 1) throw new Error('No se encontró el insumo. Ejecuta npm run db:beta2.');
  if (command.type === 'supplyMove') {
    const m = after.supplyMovements![0];
    await client.query(`INSERT INTO movimientos_insumos (id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable,motivo,estimado,creado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [m.id, m.supplyId, m.action, m.quantity, m.before, m.after, m.responsible, m.note, m.estimated, m.at]);
  }
}
