import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES } from '../lib/migration';
loadEnvConfig(process.cwd());
async function main(){
  const pool=new Pool(connectionConfig(process.env,'supabase'));
  try{
    const client=await pool.connect();
    try{
      await client.query('BEGIN READ ONLY');
      const tables=await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
      const counts:Record<string,number>={};
      for(const table of INVENTORY_TABLES){
        if(tables.rows.some(row=>row.tablename===table))counts[table]=(await client.query(`SELECT COUNT(*)::int AS n FROM public."${table}"`)).rows[0].n;
      }
      const uri=new URL(process.env.SUPABASE_DATABASE_URL!);
      const ref=uri.hostname.endsWith('.pooler.supabase.com')?decodeURIComponent(uri.username).split('.').at(-1):uri.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
      const dashboard=ref&&/^[a-z0-9]{16,32}$/.test(ref)?`https://supabase.com/dashboard/project/${ref}/editor`:undefined;
      await client.query('COMMIT');
      console.log(JSON.stringify({schema:'public',tables:tables.rows.map(row=>row.tablename),counts,dashboard},null,2));
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }finally{await pool.end();}
}
main().catch(()=>{console.error('No se pudo consultar el inventario de Supabase. No se imprimieron credenciales ni se modificaron datos.');process.exitCode=1;});
