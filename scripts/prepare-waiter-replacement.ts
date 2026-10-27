import {loadEnvConfig} from '@next/env';import {Pool} from 'pg';import {readFile,mkdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {connectionConfig} from '../lib/connection-config';import {inventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
loadEnvConfig(process.cwd());
async function main(){
 if(!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta la conexión administrativa local.');
 const pool=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL},'supabase')),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
  if(process.argv.includes('--apply')){const before=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});await writeFile(`data/backups/antes-cambio-mozo-${Date.now()}.json`,JSON.stringify(before),{flag:'wx'});await client.query(await readFile('database/017_cambio_mozo.sql','utf8'));await verifyInventorySnapshot(client,before);}
  const allowed=(await client.query(`SELECT has_column_privilege('lune_runtime','public.turno_responsables','id_usuario','UPDATE') AS member,has_column_privilege('lune_runtime','public.turno_responsables','incorporado_en','UPDATE') AS joined,has_column_privilege('lune_runtime','public.turno_responsables','orden','UPDATE') AS reorder,has_column_privilege('lune_runtime','public.turno_responsables','id_turno','UPDATE') AS shift,has_table_privilege('lune_runtime','public.turno_responsables','DELETE') AS deletion`)).rows[0];
  if(process.argv.includes('--apply')){assert.equal(allowed.member,true);assert.equal(allowed.joined,true);assert.equal(allowed.reorder,false);assert.equal(allowed.shift,false);assert.equal(allowed.deletion,false);}
  console.log(JSON.stringify({prepared:allowed.member&&allowed.joined,restricted:!allowed.reorder&&!allowed.shift&&!allowed.deletion}));await client.query('COMMIT');
  if(process.argv.includes('--apply'))console.log('Preparado: permiso limitado para reemplazar responsables. Todos los datos operativos conservados y copia privada guardada.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch(()=>{console.error('No se completó la preparación; la transacción se revirtió y no se imprimen credenciales.');process.exitCode=1;});
