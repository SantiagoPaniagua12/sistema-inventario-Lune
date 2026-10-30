import {shiftTeam,waiterNames,type Command,type State} from './inventory';
import {fruitWithdrawals,isFruitCommand} from './fruit-withdrawals';
import {COOKS,WAITERS} from './staff';
export const ROLES = ['admin', 'cocina', 'mozo'] as const;
export type Role = typeof ROLES[number];
export type Actor = { id: string; name: string; role: Role; mustChangePassword: boolean; sessionId?:string; accessVersion?:number };
export class AccessError extends Error {
  constructor(message = 'No tienes permiso para esta operación.', public status = 403) { super(message); }
}
export function selectedStaff(role:'cocina'|'mozo',value:unknown):string{
  const name=typeof value==='string'?value.trim():'';
  if(!(role==='cocina'?COOKS:WAITERS).some(person=>person===name))throw new AccessError(role==='cocina'?'Selecciona un cocinero de la lista.':'Selecciona un mozo de la lista.',400);
  return name;
}
export function authorizeCommand(actor: Actor, command: Command, state: State): Command {
  if (actor.mustChangePassword) throw new AccessError('Primero cambia tu contraseña.');
  const next = { ...command };
  const active = state.shifts.find(s => s.status === 'open');
  const kitchen=actor.role==='admin'||actor.role==='cocina';
  const salon=actor.role==='admin'||actor.role==='mozo';
  if(command.type==='correctLotDate'){
    if(!kitchen)throw new AccessError();
    const lot=state.lots.find(l=>l.id===command.lotId);
    if(!lot)throw new AccessError('Selecciona un lote válido.',400);
    next.productId=lot.productId;
  }
  if(isFruitCommand(command.type)){
    if(!salon)throw new AccessError();
    delete next.allowClosed;
    const correction=command.type==='supplyFruitWithdrawalCorrection';
    const withdrawal=correction?fruitWithdrawals(state).find(w=>w.id===command.withdrawalId):undefined;
    if(correction&&!withdrawal)throw new AccessError('Retiro de fruta inválido.',400);
    const shift=state.shifts.find(s=>s.id===(withdrawal?.shiftId??command.shiftId));
    if(!shift||command.shiftId!==shift.id)throw new AccessError('Turno del retiro inválido.',400);
    if(shift.status==='closed'){
      if(!correction||actor.role!=='admin')throw new AccessError('Solo Administración puede corregir retiros de turnos cerrados.');
      next.allowClosed=true;next.responsible=actor.name.slice(0,80);
    }else{
      next.responsible=selectedStaff('mozo',command.responsible);
      if(!shiftTeam(shift).includes(next.responsible as string))throw new AccessError('Selecciona un mozo del equipo del turno.',400);
    }
    if(typeof command.operationId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.operationId))throw new AccessError('Actualiza la página y vuelve a guardar la operación.',400);
    return next;
  }
  if(['produce','produceBatch','adjustReserve','correctLotDate','correctProduction','bakeBatch','useBaked'].includes(command.type)&&kitchen)next.responsible=selectedStaff('cocina',command.responsible);
  else if(command.type==='open'&&salon){
    try{next.responsibles=waiterNames(command.responsibles,command.period==='Tarde'?2:1);}catch(error){throw new AccessError((error as Error).message,400);}
    next.responsible=(next.responsibles as string[])[0];
  }
  else if(command.type==='addWaiters'&&salon){
    if(!active)throw new AccessError('No hay un turno abierto.',400);
    try{next.names=waiterNames(command.names);}catch(error){throw new AccessError((error as Error).message,400);}
    next.responsible=shiftTeam(active)[0];
  }
  else if(command.type==='replaceWaiter'&&salon){
    if(!active||command.shiftId!==active.id)throw new AccessError('Solo puedes cambiar mozos del turno abierto.',400);
    next.outgoing=selectedStaff('mozo',command.outgoing);next.replacement=selectedStaff('mozo',command.replacement);
    next.responsible=shiftTeam(active)[0];delete next.responsibles;
  }
  else if(command.type==='correctShift'&&salon){
    const shift=state.shifts.find(item=>item.id===command.shiftId);
    if(!shift)throw new AccessError('Selecciona un turno válido.',400);
    next.responsible=shiftTeam(shift)[0];next.responsibles=shiftTeam(shift);
    // Las compensaciones se asignan a sus lotes reales dentro de la transacción.
    delete next.lotId;
  }
  else if (['close', 'replenish','replenishBatch'].includes(command.type) && salon) {
    if (!active) throw new AccessError('No hay un turno abierto.',400);
    next.responsible=shiftTeam(active)[0];next.responsibles=shiftTeam(active);
  } else if (command.type === 'supplyMove') {
    if(actor.role==='admin')return command;
    const item = state.supplies?.find(i => i.id === command.supplyId);
    if (!item || (actor.role === 'cocina' ? !['Cocina','Frutas congeladas','Preparados líquidos'].includes(item.group) : item.group === 'Cocina')) throw new AccessError();
    next.responsible = selectedStaff(actor.role,command.responsible);
  } else if(actor.role==='admin')return command;
  else throw new AccessError();
  if(['produceBatch','replenishBatch','adjustReserve','correctLotDate','correctProduction','replaceWaiter','bakeBatch','useBaked'].includes(command.type)&& (typeof command.operationId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.operationId)))throw new AccessError('Actualiza la página y vuelve a guardar la operación.',400);
  return next;
}
