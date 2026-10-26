import {loadEnvConfig} from '@next/env';import {Pool} from 'pg';import {mkdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {connectionConfig} from '../lib/connection-config';import {inventorySnapshot,INVENTORY_TABLES} from '../lib/migration';import {reconcileWaiterRoster} from '../lib/waiter-roster';import {WAITERS} from '../lib/staff';import {personKey} from '../lib/inventory';
loadEnvConfig(process.cwd());const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;const sorted=(v:any[])=>v.map(x=>JSON.stringify(canonical(x))).sort();
async function main(){
 if(!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta la conexión administrativa local.');
 const apply=process.argv.includes('--apply'),pool=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL},'supabase')),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
  const before=await inventorySnapshot(client),profiles=(await client.query('SELECT * FROM perfiles_acceso')).rows;
  if(apply){await mkdir('data/backups',{recursive:true});await writeFile(`data/backups/antes-responsables-salon-${Date.now()}.json`,JSON.stringify(before),{flag:'wx'});}
  const result=await reconcileWaiterRoster(client,apply);
  if(apply){
   const after=await inventorySnapshot(client);for(const table of INVENTORY_TABLES)if(table!=='usuarios')assert.deepEqual(sorted(after[table]),sorted(before[table]),table);
   for(const old of before.usuarios){const current=after.usuarios.find(p=>p.id_usuario===old.id_usuario);assert(current);const waiter=WAITERS.some(name=>personKey(name)===personKey(String(old.nombre_usuario)));assert.deepEqual(current,waiter?{...old,rol:'mostrador',activo:true}:old);}
   for(const current of after.usuarios.filter(p=>!before.usuarios.some(old=>old.id_usuario===p.id_usuario))){assert(WAITERS.some(name=>personKey(name)===personKey(String(current.nombre_usuario))));assert.equal(current.rol,'mostrador');assert.equal(current.password_hash,'!');}
   assert.deepEqual(sorted((await client.query('SELECT * FROM perfiles_acceso')).rows),sorted(profiles));
   assert(result.every(p=>p.role==='mostrador'&&p.active));
  }
  console.log(JSON.stringify(result));await client.query('COMMIT');if(apply)console.log('Verificado: turnos, conteos, existencias, historial y cuentas de acceso conservados. Siete mozos activos en Salón.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch(error=>{console.error('No se completó la corrección. La transacción se revirtió; no se imprimen credenciales.');if(error instanceof assert.AssertionError)console.error('Una comprobación de conservación requiere revisión.');else if(error instanceof Error&&/responsables duplicados|tiene registros de otra área/.test(error.message))console.error(error.message);process.exitCode=1;});
