import type {Actor} from './access';
import {AccessError} from './access';
import {getPgPool} from './postgres';
import {visibleInventory} from './inventory-visibility';
import type {State} from './inventory';
import {ACTIONS,HISTORY_KINDS,legacySummary,type HistoryPage,type HistoryEntry,type OperationSummary} from './operation-history';
export async function inventoryForActor(state:State,actor:Actor){
 if(actor.role==='admin')return state;
 const ids=new Set<string>();
 if(state.supplyMovements?.length){
  const result=await getPgPool().query(`SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(detalle->'history'->'supplyMovementIds')='array' THEN detalle->'history'->'supplyMovementIds' ELSE '[]'::jsonb END) AS id FROM auditoria_acceso WHERE auth_id=$1 AND accion IN ('inventory.supplyMove','inventory.supplyFruitWithdrawal','inventory.supplyFruitWithdrawalBatch','inventory.supplyFruitWithdrawalCorrection')`,[actor.id]);
  for(const row of result.rows)ids.add(row.id);
 }
 return visibleInventory(state,actor,ids);
}
export function historyFilters(params:URLSearchParams,actor:Actor){
 const from=params.get('from')||'',to=params.get('to')||'',kind=params.get('kind')||'',cursor=params.get('cursor')||'';
 const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to))throw new AccessError('Revisa el rango de fechas.',400);
 if(kind&&!HISTORY_KINDS.includes(kind as typeof HISTORY_KINDS[number]))throw new AccessError('Tipo de movimiento inválido.',400);
 if(cursor&&(!/^\d{1,19}$/.test(cursor)||BigInt(cursor)>9223372036854775807n))throw new AccessError('Página inválida.',400);
 if(params.has('account')&&actor.role!=='admin'&&params.get('account')!==actor.id)throw new AccessError();
 const account=actor.role==='admin'?params.get('account')||'':actor.id;
 if(account&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(account))throw new AccessError('Cuenta inválida.',400);
 return {from,to,kind,cursor,account};
}
export async function readOperationHistory(params:URLSearchParams,actor:Actor,state:State):Promise<HistoryPage>{
 if(actor.mustChangePassword)throw new AccessError('Primero cambia tu contraseña.',428);
 const filters=historyFilters(params,actor),values:unknown[]=[],conditions=["a.accion LIKE 'inventory.%'"];
 const add=(sql:string,value:unknown)=>{values.push(value);conditions.push(sql.replace('?',`$${values.length}`));};
 if(filters.account)add('a.auth_id=?::uuid',filters.account);
 if(filters.from)add("(a.creado_en AT TIME ZONE 'America/Lima')::date>=?::date",filters.from);
 if(filters.to)add("(a.creado_en AT TIME ZONE 'America/Lima')::date<=?::date",filters.to);
 if(filters.cursor)add('a.id<?::bigint',filters.cursor);
 if(filters.kind){const actions=Object.entries(ACTIONS).filter(([,meta])=>meta.kind===filters.kind).map(([action])=>'inventory.'+action);if(filters.kind==='Otros')add('NOT(a.accion=ANY(?::text[]))',Object.keys(ACTIONS).map(action=>'inventory.'+action));else add('a.accion=ANY(?::text[])',actions);}
 const result=await getPgPool().query(`SELECT a.id::text,a.accion,a.detalle,a.creado_en,p.nombre,p.rol FROM auditoria_acceso a LEFT JOIN perfiles_acceso p ON p.auth_id=a.auth_id WHERE ${conditions.join(' AND ')} ORDER BY a.id DESC LIMIT 51`,values);
 const entries:HistoryEntry[]=result.rows.slice(0,50).map(row=>{
  const action=String(row.accion).slice('inventory.'.length),meta=ACTIONS[action];const detail=row.detalle??{};
  const summary=detail.history as OperationSummary|undefined;
  return {id:row.id,at:new Date(row.creado_en).toISOString(),account:row.nombre??'Cuenta anterior',area:detail.area??row.rol??'Sin cuenta identificable',action,label:meta?.label??'Movimiento anterior',kind:meta?.kind??'Otros',summary:summary??legacySummary(detail,state),legacy:!summary};
 });
 return {entries,nextCursor:result.rows.length>50?entries.at(-1)!.id:null};
}
