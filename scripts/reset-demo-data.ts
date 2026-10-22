import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { access,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES,inventorySnapshot,type InventorySnapshot } from '../lib/migration';
loadEnvConfig(process.cwd());
const activityTables=['movimientos_insumos','movimiento_inventario','detalle_turno','turnos','lotes','importaciones_excel'] as const;
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const rows=(value:unknown[])=>value.map(row=>JSON.stringify(canonical(row))).sort();
const counts=(snapshot:InventorySnapshot)=>Object.fromEntries(INVENTORY_TABLES.map(table=>[table,snapshot[table].length]));
async function main(){
  if(process.env.INVENTORY_STORAGE!=='supabase')throw new Error('El almacenamiento activo no es Supabase.');
  const apply=process.argv.includes('--apply');
  if(apply)await access(path.join(process.cwd(),'data','migration-maintenance.json'));
  const pool=new Pool(connectionConfig(process.env,'supabase'));
  let committed=false;
  try{
    const client=await pool.connect();
    try{
      await client.query(apply?'BEGIN':'BEGIN READ ONLY');
      await client.query('SET LOCAL search_path TO public');
      if(apply)await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
      const before=await inventorySnapshot(client);
      if(!apply){console.log(JSON.stringify({apply:false,activeStorage:'supabase',counts:counts(before),clearTables:activityTables,preserve:['productos','insumos (catálogo y mínimos)','usuarios','categorias','ubicaciones']},null,2));return;}
      const directory=path.join(process.cwd(),'data','resets');
      await mkdir(directory,{recursive:true});
      const backup=path.join(directory,`before-reset-${Date.now()}.json`);
      await writeFile(backup,JSON.stringify(before,null,2),{encoding:'utf8',flag:'wx'});
      // Explicit tables and FK order. No CASCADE, TRUNCATE, ID reuse or catalog deletion.
      for(const table of activityTables)await client.query(`DELETE FROM public."${table}"`);
      await client.query('UPDATE public.insumos SET stock=NULL,estimado=FALSE');
      await client.query('UPDATE public.inventario_control SET revision=revision+1 WHERE id=1');
      const after=await inventorySnapshot(client);
      for(const table of ['productos','usuarios','categorias','ubicaciones'] as const)assert.deepEqual(rows(after[table]),rows(before[table]));
      const supplyCatalog=(snapshot:InventorySnapshot)=>snapshot.insumos.map(({stock,estimado,...catalog})=>catalog);
      assert.deepEqual(rows(supplyCatalog(after)),rows(supplyCatalog(before)));
      assert(after.insumos.every(item=>item.stock===null&&item.estimado===false));
      for(const table of activityTables)assert.equal(after[table].length,0);
      assert.equal(Number(after.inventario_control[0].revision),Number(before.inventario_control[0].revision)+1);
      await client.query('COMMIT');committed=true;
      console.log(JSON.stringify({completed:true,backup:path.relative(process.cwd(),backup),before:counts(before),after:counts(after),catalogsUnchanged:true,suppliesWithoutCount:after.insumos.length,sequencesUnchanged:true},null,2));
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }catch(error){
    console.error(committed?'La limpieza se confirmó; revisar el informe final.':'La limpieza no se confirmó y la transacción se revirtió. Se conservan los catálogos.');
    if(typeof (error as {code?:string})?.code==='string')console.error(`Código: ${(error as {code:string}).code}`);
    process.exitCode=1;
  }finally{await pool.end();}
}
main().catch(()=>{console.error('No se inició la limpieza. Verifica la configuración y la pausa de registros.');process.exitCode=1;});
