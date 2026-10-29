import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
loadEnvConfig(process.cwd());
async function main(){
 const apply=process.argv.includes('--apply');
 const target=process.env.INVENTORY_STORAGE==='supabase'?'supabase':'local';
 if(apply&&target==='supabase'&&!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta conexión administrativa');
 const env=target==='supabase'&&process.env.SUPABASE_ADMIN_DATABASE_URL?{...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL}:process.env;
 const pool=new Pool(connectionConfig(env,target)),client=await pool.connect();
 try{
  await client.query(apply?'BEGIN':'BEGIN READ ONLY');
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='60s'");
  if(apply){
   await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
   const before=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});await writeFile(`data/backups/antes-horneados-${Date.now()}.json`,JSON.stringify(before),{flag:'wx',mode:0o600});
   await client.query(await readFile('database/019_horneados.sql','utf8'));
   await client.query("INSERT INTO ubicaciones(nombre_ubicacion,tipo) SELECT 'Horneados en cocina','horneados' WHERE NOT EXISTS(SELECT 1 FROM ubicaciones WHERE tipo='horneados')");
   const after=await inventorySnapshot(client),expected=structuredClone(before);
   expected.productos=expected.productos.map(p=>({...p,solo_cocina:p.solo_cocina===true||['focaccia','pan para tostada','pan para tostadas'].includes(String(p.nombre_producto).trim().toLowerCase())}));
   expected.movimiento_inventario=expected.movimiento_inventario.map(m=>({...m,fecha_operativa:m.fecha_operativa??null,periodo_cocina:m.periodo_cocina??null}));
   expected.ubicaciones=after.ubicaciones.filter(l=>l.tipo==='horneados'&&!before.ubicaciones.some(old=>old.id_ubicacion===l.id_ubicacion)).concat(before.ubicaciones);
   await verifyInventorySnapshot(client,expected);
   await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
  }
  const ready=(await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='productos' AND column_name='solo_cocina') AND EXISTS(SELECT 1 FROM ubicaciones WHERE tipo='horneados') AS ready")).rows[0].ready;
  await client.query('COMMIT');console.log(JSON.stringify({prepared:ready,applied:apply,inventoryPreserved:true}));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch((e:unknown)=>{const code=(e as {code?:string})?.code;console.error('No se completó la preparación de Horneados; la transacción se revirtió.',code&&/^[A-Z0-9_]+$/.test(code)?code:'');process.exitCode=1;});
