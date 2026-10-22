import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {connectionConfig} from '../lib/connection-config';
loadEnvConfig(process.cwd());
const role='lune_runtime';
const pendingFile='.env.local.runtime-pending';
let stage='inicio';
const grants:Record<string,string>={usuarios:'SELECT,INSERT,UPDATE',categorias:'SELECT',productos:'SELECT,INSERT,UPDATE',ubicaciones:'SELECT',lotes:'SELECT,INSERT',turnos:'SELECT,INSERT,UPDATE',detalle_turno:'SELECT,INSERT,UPDATE',movimiento_inventario:'SELECT,INSERT',inventario_control:'SELECT,UPDATE',insumos:'SELECT,INSERT,UPDATE',movimientos_insumos:'SELECT,INSERT',importaciones_excel:'SELECT,INSERT',perfiles_acceso:'SELECT,INSERT,UPDATE',sesiones_revocadas:'SELECT,INSERT',sesiones_aplicacion:'SELECT,INSERT,UPDATE',limites_acceso:'SELECT,INSERT,UPDATE',auditoria_acceso:'SELECT,INSERT'};
async function main(){
  if(process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Ya existe una conexión administrativa separada. No se rotaron credenciales.');
  const original=process.env.SUPABASE_DATABASE_URL;
  if(!original)throw new Error('Falta la conexión de Supabase.');
  const admin=new Pool(connectionConfig(process.env,'supabase'));
  let runtime:Pool|undefined;
  try{
    let pending='';try{pending=await readFile(pendingFile,'utf8');}catch{}
    const password=pending?decodeURIComponent(new URL(pending).password):randomBytes(36).toString('base64url');
    if(!/^[A-Za-z0-9_-]{48}$/.test(password))throw new Error('Preparación pendiente inválida.');
    const existing=(await admin.query('SELECT * FROM pg_roles WHERE rolname=$1',[role])).rows[0];
    if(existing && (existing.rolsuper||existing.rolcreatedb||existing.rolcreaterole||existing.rolbypassrls||existing.rolinherit||(await admin.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='lune_backend' AND $1=ANY(roles)",[role])).rows[0].n!==Object.keys(grants).length))throw new Error('El rol existente no coincide con esta preparación.');
    if(!(existing&&pending)){
    const client=await admin.connect();
    try{
      await client.query('BEGIN');
      // Identifier is a fixed constant; password is generated base64url, never user input.
      stage='rol';
      if(existing){if(!pending)await client.query(`ALTER ROLE ${role} PASSWORD '${password}'`);}
      else await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`ALTER ROLE ${role} SET search_path=public`);
      await client.query(`ALTER ROLE ${role} SET statement_timeout='15s'`);
      for(const [table,permissions] of Object.entries(grants)){
        await client.query(`GRANT ${permissions} ON TABLE public.${table} TO ${role}`);
        if(!existing)await client.query(`CREATE POLICY lune_backend ON public.${table} FOR ALL TO ${role} USING(true) WITH CHECK(true)`);
        const columns=await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',["public",table]);
        for(const column of columns.rows){const seq=(await client.query('SELECT pg_get_serial_sequence($1,$2) AS name',[`public.${table}`,column.column_name])).rows[0].name as string|null;
          if(seq&&/^[a-z0-9_.]+$/.test(seq))await client.query(`GRANT USAGE ON SEQUENCE ${seq} TO ${role}`);
        }
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
    const uri=new URL(original),username=decodeURIComponent(uri.username);
    uri.username=username.includes('.')?`${role}.${username.split('.').slice(1).join('.')}`:role;
    uri.password=password;
    await writeFile(pendingFile,uri.toString());
    stage='conexion-limitada';
    runtime=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:uri.toString()},'supabase'));
    const capabilities=(await runtime.query(`SELECT current_user,has_schema_privilege(current_user,'public','CREATE') AS ddl,has_table_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'),'SELECT') AS auth_read,has_table_privilege(current_user,'public.productos','DELETE') AS delete_catalog,has_table_privilege(current_user,'public.auditoria_acceso','UPDATE') AS edit_audit`)).rows[0];
    if(capabilities.ddl||capabilities.auth_read||capabilities.delete_catalog||capabilities.edit_audit)throw new Error('El rol heredó permisos excesivos. No se cambió la conexión activa.');
    for(const table of Object.keys(grants))await runtime.query(`SELECT 1 FROM public.${table} LIMIT 1`);
    stage='guardar-configuracion';
    let env=await readFile('.env.local','utf8');
    if(!/^SUPABASE_DATABASE_URL=/m.test(env))throw new Error('Formato de .env.local no reconocido.');
    env=env.replace(/^SUPABASE_DATABASE_URL=.*$/m,`SUPABASE_DATABASE_URL=${uri.toString()}`);
    env+=`\n# Solo para migraciones locales; no copiar a las variables de hosting.\nSUPABASE_ADMIN_DATABASE_URL=${original}\n`;
    const temp='.env.local.runtime.tmp';await writeFile(temp,env);await rename(temp,'.env.local');
    await unlink(pendingFile);
    console.log('Conexión web cambiada a lune_runtime. Sin DDL, sin lectura de auth.users, sin borrar catálogo ni alterar auditoría. Conexión administrativa conservada solo para tareas locales.');
  }finally{await runtime?.end();await admin.end();}
}
main().catch((error)=>{console.error(`No se pudo completar el aislamiento de permisos (${stage}, código ${typeof error?.code==='string'?error.code:'configuracion'}). No se imprimen credenciales.`);process.exitCode=1;});
