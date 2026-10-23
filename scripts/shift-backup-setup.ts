import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
import {BACKUP_BUCKET,BACKUP_LIMIT} from '../lib/shift-backup-format';
import {supabaseBackupStorage} from '../lib/shift-backups';
import {authTransport} from '../lib/supabase-transport';
loadEnvConfig(process.cwd());
async function main(){
  if(process.env.INVENTORY_STORAGE!=='supabase'||!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Se requiere la conexión administrativa local de Supabase.');
  const apply=process.argv.includes('--apply');
  const pool=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL},'supabase'));
  const sdk=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:authTransport},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
    const snapshot=await inventorySnapshot(client);
    const exists=(await client.query("SELECT to_regclass('public.respaldos_turno') IS NOT NULL AS present")).rows[0].present;
    if(!apply){console.log(JSON.stringify({mode:'check',tablePrepared:exists,bucket:BACKUP_BUCKET}));await client.query('ROLLBACK');return;}
    await mkdir('data/backups',{recursive:true});
    await writeFile(`data/backups/antes-respaldos-turno-${Date.now()}.json`,JSON.stringify(snapshot));
    await client.query(await readFile('database/014_respaldos_turno.sql','utf8'));
    await verifyInventorySnapshot(client,snapshot);
    const policies=(await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.respaldos_turno'::regclass")).rows[0];assert(policies.relrowsecurity);
    for(const role of ['anon','authenticated'])assert.equal((await client.query("SELECT has_table_privilege($1,'public.respaldos_turno','SELECT,INSERT,UPDATE,DELETE') AS access",[role])).rows[0].access,false);
    // Do not add Storage policies for client roles. A new bucket is accessible
    // only with the server key; pre-existing broad policies require review.
    const storagePolicies=(await client.query("SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('SELECT','ALL') AND roles && ARRAY['public','anon','authenticated']::name[]")).rows;
    if(storagePolicies.length)throw new Error('Revisar las políticas de lectura existentes de Storage antes de activar respaldos.');
    await client.query('COMMIT');
    const current=await sdk.storage.getBucket(BACKUP_BUCKET);
    if(current.data?.public)throw new Error('El bucket existente es público. No se subieron datos.');
    if(!current.data){const created=await sdk.storage.createBucket(BACKUP_BUCKET,{public:false,fileSizeLimit:BACKUP_LIMIT,allowedMimeTypes:['application/gzip']});if(created.error)throw new Error('No se pudo crear el bucket privado.');}
    const storage=supabaseBackupStorage();await storage.ensurePrivate();
    const probe=`verificacion/${crypto.randomUUID()}.json.gz`;
    const contents=gzipSync(Buffer.from(JSON.stringify({kind:'lune-storage-verification'})));
    try{
      await storage.put(probe,contents);assert.deepEqual(Buffer.from(await storage.get(probe)),contents);
      const publicUrl=sdk.storage.from(BACKUP_BUCKET).getPublicUrl(probe).data.publicUrl;
      const publicResponse=await fetch(publicUrl,{signal:AbortSignal.timeout(10000)});assert(!publicResponse.ok,'El archivo no debe ser público.');
      const anon=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:authTransport}});
      assert((await anon.storage.from(BACKUP_BUCKET).download(probe)).error,'El acceso anónimo debe estar bloqueado.');
    }finally{const removed=await sdk.storage.from(BACKUP_BUCKET).remove([probe]);if(removed.error)console.log('Quedó un archivo de verificación sin datos operativos; no se eliminó ninguna copia de turno.');}
    console.log('Preparado: tabla protegida, bucket privado y subida/descarga verificadas. Catálogo, stock y turnos sin cambios. No se generaron cierres ficticios.');
  }catch(error){await client?.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client?.release();await pool.end();}
}
main().catch(error=>{console.error('No se pudo activar completamente el respaldo por turno. No se imprimen credenciales.');console.error(/timeout|timed out/i.test(String(error?.message))?'Diagnóstico: tiempo de conexión agotado.':typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?`Código: ${error.code}`:'Revisar conexión, esquema, claves y políticas privadas de Storage.');process.exitCode=1;});
