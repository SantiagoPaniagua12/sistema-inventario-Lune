import {loadEnvConfig} from '@next/env';
import {readFile} from 'node:fs/promises';
import {getPgPool,pgTransaction} from '../lib/postgres';
import {accountFields} from '../lib/account-management';
loadEnvConfig(process.cwd());
if(process.env.SUPABASE_ADMIN_DATABASE_URL)process.env.SUPABASE_DATABASE_URL=process.env.SUPABASE_ADMIN_DATABASE_URL;
async function main(){
  const mode=process.argv[2];
  if(mode==='schema'){
    const sql=await readFile('database/008_acceso.sql','utf8');
    const sessions=await readFile('database/009_sesiones.sql','utf8');
    const areas=await readFile('database/010_cuentas_area.sql','utf8');
    await pgTransaction(async client=>{await client.query(sql);await client.query(sessions);await client.query(areas);});
    console.log('Tablas de acceso protegidas preparadas. No se modificaron existencias.');
  }else if(mode==='bootstrap'||mode==='link'){
    const fields=mode==='bootstrap'?{email:'lunealtapasteleria@gmail.com',name:'Administración Lune',role:'admin'}:accountFields({email:process.argv[3],name:process.argv[4],role:process.argv[5]});
    await pgTransaction(async client=>{
      if(mode==='bootstrap'&&(await client.query("SELECT 1 FROM perfiles_acceso WHERE rol='admin' AND activo")).rowCount)throw new Error('Ya existe administración. Usa auth:link para otras cuentas.');
      const auth=await client.query('SELECT id,email_confirmed_at FROM auth.users WHERE lower(email)=$1',[fields.email]);
      if(auth.rowCount!==1||!auth.rows[0].email_confirmed_at)throw new Error('Primero crea y confirma esta cuenta en Supabase > Authentication > Users > Add user > Create new user (no Invite). No se creó ningún perfil.');
      await client.query('INSERT INTO perfiles_acceso(auth_id,nombre,email,rol,cambiar_password) VALUES($1,$2,$3,$4,$5)',[auth.rows[0].id,fields.name,fields.email,fields.role,fields.role==='admin']);
      await client.query('INSERT INTO auditoria_acceso(auth_id,accion,detalle) VALUES($1,$2,$3)',[auth.rows[0].id,'account_linked',JSON.stringify({role:fields.role,source:'local-cli'})]);
      console.log('Cuenta vinculada. Debe cambiar su contraseña al iniciar sesión.');
    });
  }else if(mode==='status'){
    const result=await getPgPool().query("SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)='lunealtapasteleria@gmail.com') AS auth_account, EXISTS(SELECT 1 FROM perfiles_acceso WHERE rol='admin' AND activo) AS admin_profile");
    console.log(result.rows[0]);
  }else throw new Error('Usa schema, bootstrap, link o status.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'No se pudo completar la configuración.');process.exitCode=1;}).finally(()=>getPgPool().end());
