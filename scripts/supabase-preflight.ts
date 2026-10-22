import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { connectionConfig } from '../lib/connection-config';
import { INVENTORY_TABLES } from '../lib/migration';
import { getPostgresState } from '../lib/postgres-store';
import { validateBackup } from '../lib/backup';
import { createHash } from 'node:crypto';
loadEnvConfig(process.cwd());

function failure(error:unknown){
  const code=String((error as {code?:string})?.code??'CONFIGURACION');
  const reasons:Record<string,string>={
    SELF_SIGNED_CERT_IN_CHAIN:'La cadena TLS requiere el certificado CA oficial del proyecto.',
    DEPTH_ZERO_SELF_SIGNED_CERT:'La cadena TLS requiere el certificado CA oficial del proyecto.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:'No se puede verificar el certificado TLS del destino.',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'Falta una autoridad certificadora de confianza para el destino.',
    CERT_HAS_EXPIRED:'El certificado TLS está vencido.',
    ENOTFOUND:'No se resuelve el servidor configurado. Revisa la cadena de Connect.',
    ECONNREFUSED:'El destino rechazó la conexión de red.',
    ETIMEDOUT:'La conexión de red excedió el tiempo disponible.',
    '28P01':'La base rechazó el usuario o la contraseña.',
    '28000':'La base rechazó las credenciales o permisos de conexión.',
    '3D000':'No existe la base de datos configurada.',
  };
  return {ok:false,code,reason:reasons[code]??'No se pudo completar la comprobación; revisa configuración y conectividad. No se muestran mensajes del controlador que puedan contener credenciales.'};
}
async function main(){
  const report:Record<string,unknown>={migrationExecuted:false,storage:process.env.INVENTORY_STORAGE??'json'};
  const pools:Pool[]=[];
  try{
    const uri=process.env.SUPABASE_DATABASE_URL?new URL(process.env.SUPABASE_DATABASE_URL):null;
    report.configuration={connectionPresent:!!uri,passwordPresent:!!uri?.password,noFragment:!uri?.hash,noPlaceholder:!!uri&&!/YOUR.PASSWORD|\[|\]/i.test(decodeURIComponent(uri.password)),mode:uri?.hostname.endsWith('.pooler.supabase.com')?(uri.port==='6543'?'transaction pooler':'session pooler'):'direct or custom host',tlsCertificateValidation:true};
  }catch{report.configuration={ok:false,reason:'URI inválida; revisa el formato sin enviar credenciales al chat.'};}
  try{
    const config=connectionConfig(process.env,'local');
    const local=new Pool(config);pools.push(local);
    const globals=globalThis as typeof globalThis & {lunePgPool?:Pool;lunePgPoolKey?:string};
    globals.lunePgPool=local;
    globals.lunePgPoolKey=createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const state=await getPostgresState();
    validateBackup(state);
    const client=await local.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const counts:Record<string,number>={};
      for(const table of INVENTORY_TABLES) counts[table]=(await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n;
      const negativeLots=state.lots.filter(lot=>lot.quantity<0).length;
      const readyColumns=await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='productos' AND column_name='stock_minimo_reserva'`);
      const constraints=await client.query(`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`);
      await client.query('COMMIT');
      report.local={ok:negativeLots===0&&readyColumns.rowCount===1&&constraints.rows[0].n===0,backupValidation:'OK',counts,negativeLots,reserveMinimumColumn:readyColumns.rowCount===1,unvalidatedConstraints:constraints.rows[0].n,openShifts:state.shifts.filter(shift=>shift.status==='open').length};
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }catch(error){report.local=failure(error);}
  try{
    const remote=new Pool(connectionConfig(process.env,'supabase'));pools.push(remote);
    const client=await remote.connect();
    try{
      await client.query('BEGIN READ ONLY');
      const roles=await client.query(`SELECT COUNT(*)::int AS n FROM pg_roles WHERE rolname IN ('anon','authenticated')`);
      const tables=await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
      const collisions=tables.rows.filter(row=>(INVENTORY_TABLES as readonly string[]).includes(row.tablename)).map(row=>row.tablename);
      const privilege=await client.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create`);
      await client.query('COMMIT');
      report.supabase={ok:roles.rows[0].n===2&&collisions.length===0&&privilege.rows[0].can_create,supabaseRoles:roles.rows[0].n===2,inventoryTableCollisions:collisions,otherPublicTableCount:tables.rowCount,canCreateInPublic:privilege.rows[0].can_create};
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }catch(error){report.supabase=failure(error);}
  await Promise.all(pools.map(pool=>pool.end()));
  console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('No se pudo finalizar la revisión. No se ejecutó la migración ni se imprimieron credenciales.');process.exitCode=1;});
