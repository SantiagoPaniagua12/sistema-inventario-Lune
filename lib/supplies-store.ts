import {isFruitCommand} from './fruit-withdrawals';
import type { PoolClient } from 'pg';
import { initialSupplies, type Supply, type SupplyMovement } from './supplies';
import type { Command, State } from './inventory';

export async function readSupplies(client: PoolClient): Promise<{ supplies: Supply[]; supplyMovements: SupplyMovement[] }> {
  const ready = await client.query(`SELECT to_regclass('insumos') IS NOT NULL AS ready`);
  if (!ready.rows[0].ready) return { supplies: [], supplyMovements: [] };
  const items = await client.query('SELECT * FROM insumos ORDER BY categoria,nombre');
  const history = await client.query('SELECT * FROM movimientos_insumos ORDER BY orden DESC');
  return {
    // pg returns NUMERIC as text. Convert only inventory quantities and preserve pending counts.
    supplies: items.rows.map(i => ({ id: i.id_insumo, name: i.nombre, group: i.categoria, unit: i.unidad, minimum: i.stock_minimo === null ? null : Number(i.stock_minimo), stock: i.stock === null ? null : Number(i.stock), capacityMl: i.capacidad_ml, packSize: i.unidades_por_paquete, note: i.observaciones, estimated: i.estimado, ...(i.activo===undefined?{}:{active:i.activo}), ...(i.fusionado_en?{mergedInto:i.fusionado_en}:{}) })),
    supplyMovements: history.rows.map(m => ({ id: m.id_movimiento, supplyId: m.id_insumo, action: m.tipo, quantity: Number(m.cantidad), before: m.stock_anterior === null ? null : Number(m.stock_anterior), after: Number(m.stock_posterior), responsible: m.responsable, note: m.motivo, estimated: m.estimado, at: new Date(m.creado_en).toISOString(), ...(m.id_turno==null?{}:{shiftId:String(m.id_turno)}),...(m.retiro_fruta_id?{withdrawalId:String(m.retiro_fruta_id)}:{}) })),
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
  if(isFruitCommand(command.type)){
    const ready=await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='movimientos_insumos' AND column_name='retiro_fruta_id') AS ready");
    if(!ready.rows[0].ready)throw new Error('Falta preparar los retiros de fruta. Ejecuta npm run db:fruits -- --apply antes de usar esta función.');
    const previousIds=new Set(before.supplyMovements?.map(m=>m.id));
    const logs=(after.supplyMovements??[]).filter(m=>!previousIds.has(m.id));
    for(const id of new Set(logs.map(m=>m.supplyId))){
      const item=after.supplies!.find(i=>i.id===id)!;
      const updated=await client.query('UPDATE insumos SET stock=$1 WHERE id_insumo=$2',[item.stock,id]);
      if(updated.rowCount!==1)throw new Error('No se encontró la fruta.');
    }
    // Chronological insertion preserves before/after balances on reload.
    for(const m of logs.toReversed())await client.query(`INSERT INTO movimientos_insumos(id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable,motivo,estimado,creado_en,id_turno,retiro_fruta_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[m.id,m.supplyId,m.action,m.quantity,m.before,m.after,m.responsible,m.note,m.estimated,m.at,m.shiftId,m.withdrawalId]);
    return;
  }
  if(command.type==='supplyDelete'){await client.query('SELECT eliminar_insumo_sin_historial($1)',[command.supplyId]);return;}
  if(command.type==='supplyStatus'){const item=after.supplies!.find(i=>i.id===command.supplyId)!;await client.query('UPDATE insumos SET activo=$1 WHERE id_insumo=$2',[item.active!==false,item.id]);return;}
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
