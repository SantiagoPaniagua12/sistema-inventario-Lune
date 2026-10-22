import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES,inventorySnapshot,verifyInventorySnapshot } from '../lib/migration';
import { validateBackup } from '../lib/backup';
loadEnvConfig(process.cwd());
async function main(){
  if(process.env.INVENTORY_STORAGE!=='supabase')throw new Error('La aplicación todavía no selecciona Supabase.');
  const local=new Pool(connectionConfig(process.env,'local'));
  const remote=new Pool(connectionConfig(process.env,'supabase'));
  try{
    const source=await local.connect();
    try{
      const destination=await remote.connect();
      try{
        await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await destination.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const snapshot=await inventorySnapshot(source);
        await verifyInventorySnapshot(destination,snapshot);
        const security=await destination.query(`SELECT c.relname,c.relrowsecurity,
          has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_access,
          has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_access
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1)`,[INVENTORY_TABLES]);
        assert.equal(security.rowCount,INVENTORY_TABLES.length);
        assert(security.rows.every(row=>row.relrowsecurity&&!row.anon_access&&!row.authenticated_access));
        await destination.query('COMMIT');
        // Verify write permissions and immediately roll back, leaving no test records.
        await destination.query('BEGIN');
        const write=await destination.query('UPDATE inventario_control SET revision=revision WHERE id=1 RETURNING id');
        assert.equal(write.rowCount,1);
        await destination.query('ROLLBACK');
        const response=await fetch('http://127.0.0.1:3000/api/inventory');
        assert.equal(response.status,200);
        assert.equal(response.headers.get('x-inventory-storage'),'supabase');
        const state=validateBackup(await response.json());
        assert.equal(state.products.length,snapshot.productos.length);
        assert.equal(state.lots.length,snapshot.lotes.length);
        assert.equal(state.shifts.length,snapshot.turnos.length);
        assert.equal(state.supplies?.length,snapshot.insumos.length);
        const report={verifiedAt:new Date().toISOString(),storage:'supabase',allFieldsMatch:true,rlsProtectedTables:security.rowCount,publicTableAccess:false,rolledBackWriteTest:true,applicationStatus:response.status,counts:Object.fromEntries(INVENTORY_TABLES.map(table=>[table,snapshot[table].length]))};
        await mkdir(path.join(process.cwd(),'data','migrations'),{recursive:true});
        const filename=path.join(process.cwd(),'data','migrations',`verification-${Date.now()}.json`);
        await writeFile(filename,JSON.stringify(report,null,2),{flag:'wx'});
        console.log(JSON.stringify(report,null,2));
        console.log('Informe guardado en data/migrations. No se conservaron registros de prueba.');
      }finally{await destination.query('ROLLBACK').catch(()=>{});destination.release();}
    }finally{await source.query('ROLLBACK').catch(()=>{});source.release();}
  }finally{await local.end();await remote.end();}
}
main().catch(error=>{
  console.error('No se completó la verificación final. Se mantiene la pausa para revisar la conexión o los datos sin exponer información privada.');
  if(typeof error?.code==='string')console.error(`Código: ${error.code}`);
  process.exitCode=1;
});
