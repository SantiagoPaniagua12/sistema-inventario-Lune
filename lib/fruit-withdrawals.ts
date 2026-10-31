import {shiftTeam,type Command,type State} from './inventory';
import type {SupplyMovement} from './supplies';

export const isFruitCommand=(type:string)=>type==='supplyFruitWithdrawalBatch'||type==='supplyFruitWithdrawal'||type==='supplyFruitWithdrawalCorrection';
export type FruitWithdrawal={id:string;shiftId:string;supplyId:string;quantity:number;originalSupplyId:string;originalQuantity:number;responsible:string;at:string;logs:SupplyMovement[]};
/** Derive the effective withdrawal from its immutable stock movements. */
export function fruitWithdrawals(state:Pick<State,'supplyMovements'>,shiftId?:string):FruitWithdrawal[]{
 const movements=state.supplyMovements??[];
 const groups=new Map<string,SupplyMovement[]>();
 for(const m of movements)if(m.withdrawalId){const logs=groups.get(m.withdrawalId)??[];logs.push(m);groups.set(m.withdrawalId,logs);}
 return movements.filter(m=>m.withdrawalId===m.id&&(!shiftId||m.shiftId===shiftId)).map(root=>{
  const logs=groups.get(root.id)!;const balances=new Map<string,number>();
  for(const m of logs)balances.set(m.supplyId,(balances.get(m.supplyId)??0)+(m.action==='salida'?m.quantity:-m.quantity));
  const effective=[...balances].find(([,quantity])=>quantity>0);
  return {id:root.id,shiftId:root.shiftId!,supplyId:effective?.[0]??logs[0].supplyId,quantity:effective?.[1]??0,originalSupplyId:root.supplyId,originalQuantity:root.quantity,responsible:root.responsible,at:root.at,logs};
 });
}
export function executeFruitCommand(original:State,c:Command):State{
 if(c.revision!==original.revision)throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
 if(c.type==='supplyFruitWithdrawalBatch'){
  const count=original.supplies?.filter(i=>i.group==='Frutas congeladas').length??0;
  if(!Array.isArray(c.items)||!c.items.length||c.items.length>count)throw new Error('Selecciona al menos una fruta y su cantidad.');
  const seen=new Set<string>();
  const items=c.items.map(value=>{
   if(!value||typeof value!=='object')throw new Error('Retiro de fruta inválido.');
   const row=value as Record<string,unknown>;
   if(typeof row.supplyId!=='string'||!original.supplies?.some(i=>i.id===row.supplyId&&i.group==='Frutas congeladas')||seen.has(row.supplyId))throw new Error('Selecciona frutas válidas, sin repetir.');
   if(typeof row.quantity!=='number'||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>1_000_000_000)throw new Error('Porciones: ingresa una cantidad entera positiva válida.');
   seen.add(row.supplyId);return {supplyId:row.supplyId,quantity:row.quantity};
  });
  let next=original;
  for(const item of items)next=executeFruitCommand(next,{type:'supplyFruitWithdrawal',revision:next.revision,shiftId:c.shiftId,responsible:c.responsible,...item});
  return {...next,revision:original.revision+1};
 }
 const correction=c.type==='supplyFruitWithdrawalCorrection';
 const current=correction?fruitWithdrawals(original).find(w=>w.id===c.withdrawalId):undefined;
 if(correction&&!current)throw new Error('Selecciona un retiro de fruta válido.');
 if(current&&c.withdrawalVersion!==current.logs[0].id)throw new Error('Los datos cambiaron en este retiro. Actualiza la página y vuelve a abrir la corrección.');
 const shift=original.shifts.find(s=>s.id===(current?.shiftId??c.shiftId));
 if(!shift||c.shiftId!==shift.id)throw new Error('Selecciona el turno correcto del retiro.');
 if(shift.status!=='open'&&(!correction||c.allowClosed!==true))throw new Error('El turno está cerrado. Solo Administración puede corregir sus retiros.');
 if(!correction&&original.shifts.find(s=>s.status==='open')?.id!==shift.id)throw new Error('Necesitas un turno abierto.');
 const responsible=typeof c.responsible==='string'?c.responsible.trim():'';
 if(!responsible||responsible.length>80||shift.status==='open'&&!shiftTeam(shift).includes(responsible))throw new Error('Selecciona un mozo del equipo del turno.');
 const cancel=correction&&c.cancel===true;
 const quantity=cancel?0:c.quantity;
 if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<(cancel?0:1)||quantity>1_000_000_000)throw new Error('Porciones: ingresa una cantidad entera positiva válida.');
 const supplyId=cancel?current!.supplyId:c.supplyId;
 const fruit=original.supplies?.find(i=>i.id===supplyId&&i.group==='Frutas congeladas'&&i.unit==='porcion');
 if(!fruit)throw new Error('Selecciona una fruta congelada válida.');
 const reason=correction&&typeof c.reason==='string'?c.reason.trim():'';
 if(correction&&(!reason||reason.length>180))throw new Error('Indica el motivo de la corrección (máximo 180 caracteres).');
 if(current&&current.supplyId===supplyId&&current.quantity===quantity)throw new Error('No hay cambios para guardar.');
 const s=structuredClone(original);s.supplyMovements??=[];
 const withdrawalId=current?.id??crypto.randomUUID();
 const note=correction?`${cancel?'Anulación':'Corrección'} de retiro: ${original.supplies?.find(i=>i.id===current!.supplyId)?.name} (${current!.quantity}) → ${fruit.name} (${quantity}). Motivo: ${reason}`:'Retiro de fruta del turno';
 const move=(id:string,action:'entrada'|'salida',amount:number)=>{
  if(!amount)return;
  const item=s.supplies?.find(i=>i.id===id&&i.group==='Frutas congeladas'&&i.unit==='porcion');
  if(!item||item.stock===null)throw new Error('Registra primero el conteo inicial de la fruta.');
  if(action==='salida'&&(item.active===false||item.mergedInto))throw new Error('La fruta está desactivada para nuevos retiros.');
  const before=item.stock,after=before+(action==='entrada'?amount:-amount);
  if(after<0)throw new Error('No hay suficientes porciones para ese retiro.');
  if(!Number.isSafeInteger(after)||after>1_000_000_000)throw new Error('El stock resultante supera el límite permitido.');
  item.stock=after;
  s.supplyMovements!.unshift({id:current?crypto.randomUUID():withdrawalId,supplyId:id,action,quantity:amount,before,after,responsible,note,estimated:item.estimated,at:new Date().toISOString(),shiftId:shift.id,withdrawalId});
 };
 if(!current)move(fruit.id,'salida',quantity);
 else if(current.supplyId===fruit.id){const delta=quantity-current.quantity;move(fruit.id,delta>0?'salida':'entrada',Math.abs(delta));}
 else {move(current.supplyId,'entrada',current.quantity);move(fruit.id,'salida',quantity);}
 s.revision=original.revision+1;
 return s;
}
