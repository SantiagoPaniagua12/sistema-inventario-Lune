import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
loadEnvConfig(process.cwd());
async function main(){
 const apply=process.argv.includes('--apply');
 const target=process.argv.includes('--local')?'local':process.env.INVENTORY_STORAGE==='supabase'?'supabase':'local';
 if(apply&&target==='supabase'&&!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta conexión administrativa.');
 const env=apply&&target==='supabase'?{...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL}:process.env;
 const pool=new Pool(connectionConfig(env,target)),client=await pool.connect();
 try{
  await client.query(apply?'BEGIN':'BEGIN READ ONLY');
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='60s'");
  if(apply){
   await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
   const before=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});
   await writeFile(`data/backups/antes-permiso-fechas-lotes-${Date.now()}.json`,JSON.stringify(before),{flag:'wx',mode:0o600});
   const runtime=(await client.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') AS present")).rows[0].present;
   if(target==='supabase'&&!runtime)throw new Error('No existe el rol limitado esperado.');
   if(runtime)await client.query('GRANT UPDATE(fecha_produccion) ON public.lotes TO lune_runtime');
   await verifyInventorySnapshot(client,before);
  }
  const prepared=(await client.query("SELECT has_column_privilege(CASE WHEN $1::boolean AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN 'lune_runtime' ELSE current_user END,'public.lotes','fecha_produccion','UPDATE') AS ready",[apply])).rows[0].ready;
  await client.query('COMMIT');console.log(JSON.stringify({target,prepared,applied:apply,inventoryPreserved:true,schemaChanged:false}));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch((e:unknown)=>{const code=(e as {code?:string})?.code;console.error('No se completó la preparación del permiso de fecha; se revirtió la transacción.',code&&/^[A-Z0-9_]+$/.test(code)?code:'');process.exitCode=1;});
