import {loadEnvConfig} from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {BACKUP_BUCKET,BACKUP_LIMIT} from '../lib/shift-backup-format';
import {supabaseBackupStorage} from '../lib/shift-backups';
import {authTransport} from '../lib/supabase-transport';
loadEnvConfig(process.cwd());
async function main(){
  if(process.env.INVENTORY_STORAGE!=='supabase')throw new Error('Se requiere Supabase.');
  const sdk=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:authTransport},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
  const current=await sdk.storage.getBucket(BACKUP_BUCKET);
  if(current.data?.public)throw new Error('Bucket público.');
  if(!current.data){const result=await sdk.storage.createBucket(BACKUP_BUCKET,{public:false,fileSizeLimit:BACKUP_LIMIT,allowedMimeTypes:['application/gzip']});if(result.error)throw new Error('No se pudo crear el bucket privado.');}
  const storage=supabaseBackupStorage();await storage.ensurePrivate();
  const probe=`verificacion/${crypto.randomUUID()}.json.gz`;
  const bytes=gzipSync(Buffer.from(JSON.stringify({kind:'lune-storage-verification'})));
  try{
    await storage.put(probe,bytes);await storage.put(probe,bytes);assert.deepEqual(Buffer.from(await storage.get(probe)),bytes);
    const publicResponse=await fetch(sdk.storage.from(BACKUP_BUCKET).getPublicUrl(probe).data.publicUrl,{signal:AbortSignal.timeout(10000)});assert(!publicResponse.ok);
    const anon=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:authTransport}});
    assert((await anon.storage.from(BACKUP_BUCKET).download(probe)).error);
    console.log('Bucket lune-cierres privado creado/verificado. Subida y descarga del servidor correctas; acceso público y anónimo bloqueados.');
  }finally{const removed=await sdk.storage.from(BACKUP_BUCKET).remove([probe]);if(removed.error)console.log('Archivo de verificación pendiente de limpieza; no contiene datos operativos.');}
}
main().catch(()=>{console.error('No se pudo preparar/verificar Storage. No se imprimen credenciales.');process.exitCode=1;});
