import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
loadEnvConfig(process.cwd());
async function main(){
 const apply=process.argv.includes('--apply');
 const target=process.argv.includes('--local')?'local':process.env.INVENTORY_STORAGE==='supabase'?'supabase':'local';
 if(apply&&target==='supabase'&&!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta conexión administrativa.');
 const env=target==='supabase'&&process.env.SUPABASE_ADMIN_DATABASE_URL?{...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL}:process.env;
 const pool=new Pool(connectionConfig(env,target)),client=await pool.connect();
 try{
  await client.query(apply?'BEGIN':'BEGIN READ ONLY');
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='60s'");
  if(apply){
   await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
   const before=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});
   await writeFile(`data/backups/antes-retiros-fruta-${Date.now()}.json`,JSON.stringify(before),{flag:'wx',mode:0o600});
   await client.query(await readFile('database/020_retiros_fruta.sql','utf8'));
   const expected=structuredClone(before);
   expected.movimientos_insumos=expected.movimientos_insumos.map(m=>({...m,id_turno:m.id_turno??null,retiro_fruta_id:m.retiro_fruta_id??null}));
   await verifyInventorySnapshot(client,expected);
   await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
  }
  const ready=(await client.query("SELECT COUNT(*)=2 AS ready FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='movimientos_insumos' AND column_name IN ('id_turno','retiro_fruta_id')")).rows[0].ready;
  await client.query('COMMIT');console.log(JSON.stringify({target,prepared:ready,applied:apply,inventoryPreserved:true}));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch((e:unknown)=>{const code=(e as {code?:string})?.code;console.error('No se completó la preparación de retiros de fruta; se revirtió la transacción.',code&&/^[A-Z0-9_]+$/.test(code)?code:'');process.exitCode=1;});
