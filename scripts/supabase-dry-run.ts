import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES,inventorySnapshot,insertInventorySnapshot } from '../lib/migration';
loadEnvConfig(process.cwd());
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
async function main(){
  const pool=new Pool(connectionConfig(process.env,'local'));
  const client=await pool.connect();
  const schema=`lune_revision_${crypto.randomUUID().replaceAll('-','')}`;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const snapshot=await inventorySnapshot(client);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const base=await readFile(path.join(process.cwd(),'database','schema.sql'),'utf8');
    await client.query(base.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,''));
    for(const filename of ['002_control.sql','005_insumos.sql','007_alertas_excel.sql'])await client.query(await readFile(path.join(process.cwd(),'database',filename),'utf8'));
    await insertInventorySnapshot(client,snapshot);
    const restored=await inventorySnapshot(client);
    for(const table of INVENTORY_TABLES){
      const rows=(value:unknown[])=>value.map(row=>JSON.stringify(canonical(row))).sort();
      assert.deepEqual(rows(restored[table]),rows(snapshot[table]));
    }
    console.log('OK: ensayo de copia y restauración de los datos locales reales; coinciden todos los campos de las 12 tablas.');
    console.log('La transacción de ensayo se revierte: no se conserva el esquema de prueba, no cambia el inventario y no se conecta a Supabase.');
  }finally{await client.query('ROLLBACK');client.release();await pool.end();}
}
main().catch(()=>{console.error('El ensayo detectó un problema de esquema o contenido. No se ejecutó la migración a Supabase ni se imprimieron datos privados.');process.exitCode=1;});
