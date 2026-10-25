import type {PoolClient} from 'pg';
import {AccessError,type Actor} from './access';
import {pgTransaction} from './postgres';
import {assertInventoryWritable} from './maintenance';
import type {DraftField,DraftSnapshot} from './closing-draft-model';

export class DraftConflictError extends AccessError {
  constructor(public draft:DraftSnapshot){super('Hay conteos más recientes. Revisa los campos en conflicto antes de continuar.',409);}
}
function identifier(value:unknown):string {
  if(typeof value!=='string'||!/^\d{1,10}$/.test(value)||Number(value)<1||Number(value)>2147483647)throw new AccessError('Turno o producto inválido.',400);
  return value;
}
export function validateDraftRequest(body:Record<string,unknown>):DraftSnapshot {
  const shiftId=identifier(body.shiftId);
  if(!Array.isArray(body.fields)||!body.fields.length||body.fields.length>1000)throw new AccessError('Envía entre 1 y 1000 conteos.',400);
  const ids=new Set<string>();
  const fields=body.fields.map((item:unknown):DraftField=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new AccessError('Conteo inválido.',400);
    const field=item as Record<string,unknown>,productId=identifier(field.productId);
    if(ids.has(productId))throw new AccessError('Hay productos repetidos en el borrador.',400);
    ids.add(productId);
    if(field.value!==null&&(typeof field.value!=='number'||!Number.isSafeInteger(field.value)||field.value<0||field.value>100000))throw new AccessError('El conteo debe estar entre 0 y 100000.',400);
    if(typeof field.version!=='number'||!Number.isSafeInteger(field.version)||field.version<0||field.version>=2147483647)throw new AccessError('Versión de conteo inválida.',400);
    return {productId,value:field.value as number|null,version:field.version};
  });
  return {shiftId,fields};
}
async function assertActor(client:PoolClient,actor:Actor) {
  if(actor.mustChangePassword)throw new AccessError('Primero cambia tu contraseña.',428);
  const result=await client.query('SELECT * FROM perfiles_acceso WHERE auth_id=$1 FOR SHARE',[actor.id]);
  const profile=result.rows[0];
  if(!profile?.activo||profile.cambiar_password||!['admin','mozo'].includes(profile.rol))throw new AccessError('Solo Salón y Administración pueden guardar conteos de cierre.');
  if(actor.sessionId){
    const session=await client.query(`SELECT 1 FROM sesiones_aplicacion s WHERE session_id=$1 AND auth_id=$2 AND version_acceso=$3 AND NOT EXISTS(SELECT 1 FROM sesiones_revocadas WHERE session_id=$1)`,[actor.sessionId,actor.id,profile.version_acceso]);
    if(profile.version_acceso!==actor.accessVersion||!session.rowCount)throw new AccessError('La sesión fue cerrada. Inicia sesión nuevamente.',401);
  }
}
async function snapshot(client:PoolClient,shiftId:string):Promise<DraftSnapshot> {
  const shift=await client.query('SELECT estado FROM turnos WHERE id_turno=$1 FOR SHARE',[shiftId]);
  if(!shift.rowCount)throw new AccessError('No se encontró el turno.',404);
  if(shift.rows[0].estado!=='abierto')throw new AccessError('El turno ya está cerrado. Sus conteos no se pueden sobrescribir.',409);
  const result=await client.query(`SELECT d.id_producto,b.cantidad,COALESCE(b.version,0) AS version FROM detalle_turno d LEFT JOIN borradores_cierre b USING(id_turno,id_producto) WHERE d.id_turno=$1 ORDER BY d.id_producto`,[shiftId]);
  return {shiftId,fields:result.rows.map(row=>({productId:String(row.id_producto),value:row.cantidad??null,version:Number(row.version)}))};
}
export async function getClosingDraft(shiftId:string,actor:Actor):Promise<DraftSnapshot> {
  identifier(shiftId);
  return pgTransaction(async client=>{await assertActor(client,actor);return snapshot(client,shiftId);});
}
export async function saveClosingDraft(body:Record<string,unknown>,actor:Actor):Promise<DraftSnapshot> {
  const request=validateDraftRequest(body);
  return pgTransaction(async client=>{
    await assertInventoryWritable();await assertActor(client,actor);
    const current=await snapshot(client,request.shiftId);
    const map=new Map(current.fields.map(field=>[field.productId,field]));
    for(const field of request.fields){
      const previous=map.get(field.productId);
      if(!previous)throw new AccessError('El producto no pertenece a este turno.',400);
      // A retry whose response was lost is harmless when its value is already saved.
      if(previous.version!==field.version&&previous.value!==field.value)throw new DraftConflictError(current);
    }
    for(const field of request.fields){
      if(map.get(field.productId)!.value===field.value)continue;
      await client.query(`INSERT INTO borradores_cierre(id_turno,id_producto,cantidad,version,actualizado_por) VALUES($1,$2,$3,1,$4) ON CONFLICT(id_turno,id_producto) DO UPDATE SET cantidad=EXCLUDED.cantidad,version=borradores_cierre.version+1,actualizado_en=now(),actualizado_por=EXCLUDED.actualizado_por`,[request.shiftId,field.productId,field.value,actor.id]);
    }
    return snapshot(client,request.shiftId);
  });
}

// Invoked inside the inventory close transaction with its advisory lock already held.
export async function assertClosingDrafts(client:PoolClient,shiftId:string,counts:unknown,versions:unknown,zeroStockIds:ReadonlySet<string>=new Set()) {
  const result=await client.query('SELECT id_producto,cantidad,version FROM borradores_cierre WHERE id_turno=$1',[shiftId]);
  if(!result.rowCount)return;
  const values=counts&&typeof counts==='object'&&!Array.isArray(counts)?counts as Record<string,unknown>:{};
  const expected=versions&&typeof versions==='object'&&!Array.isArray(versions)?versions as Record<string,unknown>:{};
  for(const row of result.rows){
    const id=String(row.id_producto);
    if(expected[id]!==row.version||values[id]!==row.cantidad&&!(zeroStockIds.has(id)&&values[id]===0))throw new AccessError('Los conteos cambiaron en otra pestaña. Actualiza el borrador antes de cerrar el turno.',409);
  }
}
