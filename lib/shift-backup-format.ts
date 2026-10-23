import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {InventorySnapshot} from './migration';
import type {State,Shift} from './inventory';

export const BACKUP_BUCKET='lune-cierres';
export const BACKUP_LIMIT=50*1024*1024;
export type ShiftBackup={
  format:'lune-cierre-v1';
  capturedAt:string;
  trigger:{shiftId:string;date:string;period:Shift['period'];reason:'cierre'|'correccion'};
  inventory:State;
  tables:InventorySnapshot;
};
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function backupJson(value:unknown){return JSON.stringify(canonical(value));}
export function backupHash(value:unknown){return createHash('sha256').update(backupJson(value)).digest('hex');}
export function backupPath(shift:Shift,revision:number){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(shift.date)||!/^\d+$/.test(shift.id)||!Number.isSafeInteger(revision)||revision<0)throw new Error('Metadatos de respaldo inválidos.');
  return `${shift.date.slice(0,4)}/${shift.date.slice(5,7)}/${shift.date}_${shift.period==='Mañana'?'manana':'tarde'}_turno-${shift.id}_rev-${revision}.json.gz`;
}
export function makeShiftBackup(state:State,tables:InventorySnapshot,shift:Shift,reason:ShiftBackup['trigger']['reason'],capturedAt=new Date().toISOString()):ShiftBackup{
  if(shift.status!=='closed')throw new Error('Solo se respaldan cierres confirmados.');
  // Los usuarios de registro se recuperan sin credenciales. Supabase Auth y sus
  // sesiones no forman parte de este respaldo operativo.
  const sanitized=structuredClone(tables);
  sanitized.usuarios=sanitized.usuarios.map(row=>({...row,password_hash:'!',email:null}));
  return {format:'lune-cierre-v1',capturedAt,trigger:{shiftId:shift.id,date:shift.date,period:shift.period,reason},inventory:state,tables:sanitized};
}
export function encodeShiftBackup(payload:ShiftBackup,expectedHash:string){
  if(backupHash(payload)!==expectedHash)throw new Error('BACKUP_CHECKSUM');
  const raw=Buffer.from(backupJson(payload));
  if(raw.length>BACKUP_LIMIT)throw new Error('BACKUP_SIZE');
  return gzipSync(raw);
}
export function decodeShiftBackup(data:Uint8Array,expectedHash:string):ShiftBackup{
  const raw=gunzipSync(data,{maxOutputLength:BACKUP_LIMIT});
  const payload=JSON.parse(raw.toString('utf8')) as ShiftBackup;
  if(payload?.format!=='lune-cierre-v1'||backupHash(payload)!==expectedHash)throw new Error('BACKUP_CHECKSUM');
  return payload;
}
