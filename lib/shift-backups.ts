import type {PoolClient} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {authTransport} from './supabase-transport';
import {getPgPool} from './postgres';
import {inventorySnapshot} from './migration';
import type {State,Shift} from './inventory';
import {BACKUP_BUCKET,BACKUP_LIMIT,backupHash,backupPath,makeShiftBackup,encodeShiftBackup,decodeShiftBackup,type ShiftBackup} from './shift-backup-format';

export function shiftBackupsEnabled(){return process.env.INVENTORY_STORAGE==='supabase'||process.env.SHIFT_BACKUPS_ENABLED==='true';}
export async function enqueueShiftBackup(client:PoolClient,state:State,shift:Shift,reason:ShiftBackup['trigger']['reason']){
  const payload=makeShiftBackup(state,await inventorySnapshot(client),shift,reason);
  await client.query(`INSERT INTO respaldos_turno(id,id_turno,revision,fecha,periodo,motivo,contenido,sha256,archivo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
    crypto.randomUUID(),shift.id,state.revision,shift.date,shift.period==='Mañana'?'manana':'tarde',reason,JSON.stringify(payload),backupHash(payload),backupPath(shift,state.revision),
  ]);
}
export type BackupJob={id:string;contenido:ShiftBackup;sha256:string;archivo:string;bloqueo:string;intentos:number};
export interface BackupStorage{
  ensurePrivate():Promise<void>;
  put(path:string,data:Uint8Array):Promise<void>;
  get(path:string):Promise<Uint8Array>;
}
export class BackupStorageError extends Error{constructor(public code:string){super(code);}}
export function supabaseBackupStorage():BackupStorage{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new BackupStorageError('BACKUP_CONFIG');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.username||parsed.password)throw new BackupStorageError('BACKUP_CONFIG');
  const sdk=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:authTransport},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(6000)})}});
  return {
    async ensurePrivate(){
      const result=await sdk.storage.getBucket(BACKUP_BUCKET);
      if(result.error||!result.data)throw new BackupStorageError('BACKUP_BUCKET_MISSING');
      if(result.data.public)throw new BackupStorageError('BACKUP_BUCKET_PUBLIC');
    },
    async put(path,data){
      const result=await sdk.storage.from(BACKUP_BUCKET).upload(path,data,{contentType:'application/gzip',upsert:false,cacheControl:'0'});
      // A previous invocation may have uploaded successfully before its database
      // acknowledgement failed. The caller verifies the existing content next.
      if(result.error&&!['409','Duplicate'].includes(String(result.error.statusCode))&&result.error.message!=='The resource already exists')throw new BackupStorageError('BACKUP_UPLOAD');
    },
    async get(path){
      const result=await sdk.storage.from(BACKUP_BUCKET).download(path);
      if(result.error||!result.data)throw new BackupStorageError('BACKUP_DOWNLOAD');
      if(result.data.size>BACKUP_LIMIT)throw new BackupStorageError('BACKUP_SIZE');
      return new Uint8Array(await result.data.arrayBuffer());
    },
  };
}
export async function uploadAndVerifyBackup(job:BackupJob,storage:BackupStorage){
  await storage.ensurePrivate();
  const compressed=encodeShiftBackup(job.contenido,job.sha256);
  await storage.put(job.archivo,compressed);
  const saved=await storage.get(job.archivo);
  decodeShiftBackup(saved,job.sha256);
  return saved.byteLength;
}
function safeCode(error:unknown){
  const code=error instanceof BackupStorageError?error.code:error instanceof Error?error.message:'';
  return /^BACKUP_[A-Z_]+$/.test(code)?code:'BACKUP_TEMPORARY';
}
export async function processShiftBackups(options:{limit?:number;force?:boolean;storage?:BackupStorage}={}){
  if(!shiftBackupsEnabled())return {saved:0,failed:0};
  const pool=getPgPool();let saved=0,failed=0;
  const limit=Math.max(1,Math.min(options.limit??1,3));
  // Claim one job at a time; another process can retry an abandoned lease.
  for(let index=0;index<limit;index++){
    const lease=crypto.randomUUID();
    const result=await pool.query(`UPDATE respaldos_turno SET bloqueo=$1,bloqueado_hasta=now()+interval '2 minutes',intentos=intentos+1
      WHERE id=(SELECT id FROM respaldos_turno WHERE estado='pendiente' AND ($2::boolean OR reintentar_en<=now()) AND (bloqueado_hasta IS NULL OR bloqueado_hasta<now()) ORDER BY creado_en,revision FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,contenido,sha256,archivo,bloqueo,intentos`,[lease,!!options.force]);
    const job=result.rows[0] as BackupJob|undefined;if(!job)break;
    try{
      const bytes=await uploadAndVerifyBackup(job,options.storage??supabaseBackupStorage());
      const ack=await pool.query(`UPDATE respaldos_turno SET estado='guardado',guardado_en=now(),bytes=$3,contenido=NULL,ultimo_error=NULL,bloqueo=NULL,bloqueado_hasta=NULL WHERE id=$1 AND bloqueo=$2 AND estado='pendiente'`,[job.id,lease,bytes]);
      if(ack.rowCount)saved++;
    }catch(error){
      failed++;
      await pool.query(`UPDATE respaldos_turno SET ultimo_error=$3,reintentar_en=now()+$4*interval '1 second',bloqueo=NULL,bloqueado_hasta=NULL WHERE id=$1 AND bloqueo=$2 AND estado='pendiente'`,[job.id,lease,safeCode(error),Math.min(3600,60*2**Math.min(job.intentos,6))]);
    }
  }
  return {saved,failed};
}
export async function backupPendingStatus(){
  if(!shiftBackupsEnabled())return 'disabled';
  try{return (await getPgPool().query("SELECT 1 FROM respaldos_turno WHERE estado='pendiente' LIMIT 1")).rowCount?'pending':'ok';}
  catch{return 'unavailable';}
}
export async function retryBackupsQuietly(){
  try{await processShiftBackups();}catch{console.error('lune.backup.failure',{code:'BACKUP_WORKER'});}
}
