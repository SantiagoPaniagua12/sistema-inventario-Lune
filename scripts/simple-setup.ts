import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {connectionConfig} from '../lib/connection-config';

loadEnvConfig(process.cwd());
const legacy=['usuarios','categorias','productos','ubicaciones','lotes','turnos','detalle_turno','movimiento_inventario','inventario_control','insumos','movimientos_insumos','importaciones_excel'];
const additions=['turno_responsables','operaciones_inventario','borradores_cierre'];
const canonical=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).sort();

async function main(){
  const apply=process.argv.includes('--apply');
  const supabase=process.env.INVENTORY_STORAGE==='supabase';
  const adminUrl=process.env.SUPABASE_ADMIN_DATABASE_URL;
  if(supabase&&!adminUrl)throw new Error('Falta la conexión administrativa local para migraciones.');
  const pool=new Pool(connectionConfig({...process.env,...(supabase?{SUPABASE_DATABASE_URL:adminUrl}: {})},supabase?'supabase':'local'));
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
    const snapshot:Record<string,unknown[]>={};
    const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows.map(row=>String(row.tablename));
    assert(legacy.every(table=>tables.includes(table)),'La base no tiene el inventario esperado.');
    for(const table of tables){
      if(!/^[a-z_]+$/.test(table))throw new Error('Nombre de tabla no previsto.');
      snapshot[table]=(await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(row=>row.row);
    }
    if(!apply){
      console.log(JSON.stringify({mode:'check',storage:supabase?'supabase':'postgres',tables:tables.length,pending:additions.filter(table=>!tables.includes(table)),products:snapshot.productos.length,shifts:snapshot.turnos.length,lots:snapshot.lotes.length}));
      await client.query('ROLLBACK');return;
    }
    await mkdir('data/backups',{recursive:true});
    const file=`data/backups/operacion-simple-${Date.now()}.json`;
    await writeFile(file,JSON.stringify({at:new Date().toISOString(),tables:snapshot},null,2));
    for(const name of ['012_operacion_simple.sql','013_borradores.sql']){
      const sql=await readFile(`database/${name}`,'utf8');
      if(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql))throw new Error('La migración debe usar la transacción del instalador.');
      await client.query(sql);
    }
    // Existing catalog, quantities, shifts and movements must remain byte-for-byte equivalent.
    for(const table of legacy){
      const after=(await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t`)).rows.map(row=>row.row);
      const keys=snapshot[table].length?Object.keys(snapshot[table][0] as object):[];
      const projected=after.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])));
      assert.deepEqual(canonical(projected),canonical(snapshot[table]),`Se intentó alterar datos existentes en ${table}`);
    }
    const policies=await client.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1)",[additions]);
    assert.equal(policies.rowCount,3);assert(policies.rows.every(row=>row.relrowsecurity));
    await client.query('COMMIT');
    console.log(`Actualización preparada. Catálogo, existencias y cierres conservados; respaldo privado: ${file}.`);
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();await pool.end();}
}
main().catch(error=>{console.error(`No se aplicó la actualización (${typeof error?.code==='string'?error.code:'verificacion'}). Revisa el esquema; no se imprimen credenciales ni datos privados.`);process.exitCode=1;});
