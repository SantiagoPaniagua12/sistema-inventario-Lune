import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
import {inventorySnapshot,verifyInventorySnapshot,INVENTORY_TABLES} from '../lib/migration';
import {addSalonSupplies} from '../lib/salon-supplies-migration';
import {supplyNameKey,salonSupplies} from '../lib/salon-supplies';
import assert from 'node:assert/strict';
loadEnvConfig(process.cwd());
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const sorted=(rows:any[])=>rows.map(row=>JSON.stringify(canonical(row))).sort();
async function main(){
 const mode=process.argv[2];if(!['schema','data'].includes(mode))throw new Error('Elige schema o data.');
 if(!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta la conexión administrativa local.');
 const pool=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL},'supabase')),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
  const before=await inventorySnapshot(client);await mkdir('data/backups',{recursive:true});await writeFile(`data/backups/antes-insumos-salon-${mode}-${Date.now()}.json`,JSON.stringify(before),{flag:'wx'});
  if(mode==='schema'){await client.query(await readFile('database/016_insumos_salon.sql','utf8'));await verifyInventorySnapshot(client,before);console.log('Categoría y unidad preparadas. Todos los registros conservados.');}
  else{
   const result=await addSalonSupplies(client),after=await inventorySnapshot(client);
   for(const table of INVENTORY_TABLES)if(!['inventario_control','insumos'].includes(table))assert.deepEqual(sorted(after[table]),sorted(before[table]),table);
   for(const old of before.insumos){const current=after.insumos.find(row=>row.id_insumo===old.id_insumo)!;assert(current);const expected=salonSupplies().find(item=>supplyNameKey(item.name)===supplyNameKey(String(old.nombre)));assert.deepEqual(current,expected?{...old,categoria:expected.group}:old);}
   for(const current of after.insumos.filter(row=>!before.insumos.some(old=>old.id_insumo===row.id_insumo))){assert.equal(current.stock,null);assert.equal(current.stock_minimo,null);}
   console.log(JSON.stringify(result));console.log('Verificado: existencias, mínimos, historial y conteos pendientes conservados. Nuevos insumos sin cantidades inventadas.');
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
}
main().catch(error=>{console.error('No se completó la actualización de insumos. La transacción se revirtió y se conserva la copia privada.');if(error instanceof assert.AssertionError)console.error('Una comprobación de conservación no coincide.');process.exitCode=1;});
