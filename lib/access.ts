import type { Command, State } from './inventory';
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
  if (actor.role === 'admin') {
    if(['produce','open','replenish','close'].includes(command.type))return {...command,responsible:selectedStaff(command.type==='produce'?'cocina':'mozo',command.responsible)};
    return command;
  }
  const next = { ...command };
  const active = state.shifts.find(s => s.status === 'open');
  if (command.type === 'produce' && actor.role === 'cocina') next.responsible = selectedStaff('cocina',command.responsible);
  else if (command.type === 'open' && actor.role === 'mozo') next.responsible = selectedStaff('mozo',command.responsible);
  else if (['close', 'replenish'].includes(command.type) && actor.role === 'mozo') {
    if (!active) throw new AccessError('No hay un turno abierto.',400);
    next.responsible=selectedStaff('mozo',command.responsible);
  } else if (command.type === 'supplyMove') {
    const item = state.supplies?.find(i => i.id === command.supplyId);
    if (!item || (actor.role === 'cocina' ? !['Cocina','Frutas congeladas','Preparados líquidos'].includes(item.group) : item.group === 'Cocina')) throw new AccessError();
    next.responsible = selectedStaff(actor.role,command.responsible);
  } else throw new AccessError();
  return next;
}
