import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot} from '../lib/migration';
import {migrateCatalog} from '../lib/catalog-migration';
loadEnvConfig(process.cwd());
async function main(){
 const mode=process.argv[2];if(!['check','schema','data'].includes(mode))throw new Error('Elige check, schema o data.');
 const admin=process.env.SUPABASE_ADMIN_DATABASE_URL;if(!admin)throw new Error('Falta la conexión administrativa local.');
 const pool=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:admin},'supabase'));const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
  if(mode==='check'){console.log(JSON.stringify((await client.query("SELECT id_insumo,nombre,stock,stock_minimo,unidad,unidades_por_paquete FROM insumos WHERE id_insumo=ANY($1) ORDER BY id_insumo",[['insumo-1','insumo-2','kombucha-0','kombucha-1','kombucha-2','kombuchas']])).rows));}
  else{
   const snapshot=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});
   const file=`data/backups/antes-catalogo-${mode}-${Date.now()}.json`;await writeFile(file,JSON.stringify(snapshot),{flag:'wx'});
   if(mode==='schema'){await client.query(await readFile('database/015_catalogo_operacion.sql','utf8'));console.log('Campos y permisos preparados. Existencias conservadas.');}
   else console.log(JSON.stringify(await migrateCatalog(client)));
   console.log('Copia privada guardada antes de la actualización.');
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch(()=>{console.error('No se completó la actualización. La transacción se revirtió; no se imprimen credenciales.');process.exitCode=1;});
