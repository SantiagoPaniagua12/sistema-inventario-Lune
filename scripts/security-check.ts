import {loadEnvConfig} from '@next/env';
import {getPgPool} from '../lib/postgres';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
loadEnvConfig(process.cwd());
async function main(){
  const pool=getPgPool();
  const permissions=(await pool.query(`SELECT current_user AS role,has_schema_privilege(current_user,'public','CREATE') AS can_create_tables,has_table_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'),'SELECT') AS can_read_auth_users,has_table_privilege(current_user,'public.productos','DELETE') AS can_delete_products,has_table_privilege(current_user,'public.auditoria_acceso','UPDATE,DELETE') AS can_alter_audit`)).rows[0];
  assert.equal(permissions.role,'lune_runtime');
  for(const key of ['can_create_tables','can_read_auth_users','can_delete_products','can_alter_audit'])assert.equal(permissions[key],false,key);
  const tables=await pool.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_access,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
  assert.equal(tables.rows.length,17);
  for(const table of tables.rows){assert.equal(table.rls,true,table.name);assert.equal(table.anon_access,false,table.name);assert.equal(table.authenticated_access,false,table.name);}
  const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM productos) AS products,(SELECT count(*)::int FROM insumos) AS supplies,(SELECT count(*)::int FROM insumos WHERE stock IS NOT NULL) AS supplies_with_count,(SELECT count(*)::int FROM lotes) AS lots,(SELECT count(*)::int FROM turnos) AS shifts,(SELECT count(*)::int FROM movimiento_inventario) AS inventory_movements,(SELECT count(*)::int FROM movimientos_insumos) AS supply_movements,(SELECT count(*)::int FROM importaciones_excel) AS excel_imports,(SELECT count(*)::int FROM perfiles_acceso) AS access_profiles`)).rows[0];
  const settings=await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY!}}).then(r=>r.json());
  assert.equal(settings.disable_signup,true,'public signup must be disabled');
  const report={at:new Date().toISOString(),permissions,tables:tables.rows,counts,publicSignupDisabled:settings.disable_signup};
  await mkdir('data/security',{recursive:true});const file=`data/security/check-${Date.now()}.json`;await writeFile(file,JSON.stringify(report,null,2));
  console.log('OK: 17 tablas protegidas por RLS, sin acceso directo de usuarios anónimos o autenticados, rol web limitado y registro público desactivado.');
  console.log(JSON.stringify(counts));console.log(`Informe sin credenciales: ${file}`);
}
main().catch(()=>{console.error('Falló una comprobación de seguridad. Revisa la configuración antes de publicar. No se imprimen credenciales.');process.exitCode=1;}).finally(()=>getPgPool().end());
