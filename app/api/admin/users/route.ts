import {createClient} from '@supabase/supabase-js';
import {authTransport as WebSocket} from '@/lib/supabase-transport';
import {requireAdmin,authError} from '@/lib/auth';
import {authConfig} from '@/lib/auth-config';
import {assertOrigin,readJson,rateLimit} from '@/lib/http-security';
import {AccessError,ROLES,type Role} from '@/lib/access';
import {accountFields,assertAccountChange} from '@/lib/account-management';
import {getPgPool,pgTransaction} from '@/lib/postgres';
export const runtime='nodejs';
export async function GET(){try{await requireAdmin();const result=await getPgPool().query('SELECT auth_id AS id,nombre AS name,email,rol AS role,activo AS active,cambiar_password AS "mustChangePassword" FROM perfiles_acceso ORDER BY creado_en');return Response.json({users:result.rows,canCreate:Boolean(process.env.SUPABASE_SECRET_KEY)},{headers:{'Cache-Control':'no-store'}});}catch(error){return authError(error);}}
export async function POST(request:Request){try{
  assertOrigin(request);const actor=await requireAdmin();await rateLimit('users',actor.id,10,60);const data=await readJson(request,4096);
  if(data.action==='create'){
    const fields=accountFields(data),password=data.password;
    if(fields.role==='admin')throw new AccessError('La administración existente se conserva. Solo se crean las cuentas de Cocina y Salón.',400);
    if((await getPgPool().query('SELECT 1 FROM perfiles_acceso WHERE rol=$1',[fields.role])).rowCount)throw new AccessError('Ya existe la cuenta de esta área. Actívala desde administración.',409);
    if(typeof password!=='string'||password.length<12||password.length>128)throw new AccessError('Usa una contraseña temporal de 12 a 128 caracteres.',400);
    const config=authConfig(),key=process.env.SUPABASE_SECRET_KEY;
    if(!config||!key)throw new AccessError('Configura SUPABASE_SECRET_KEY en el servidor para crear cuentas. También puedes usar el panel de Supabase y el comando auth:link.',503);
    const admin=createClient(config.url,key,{realtime:{transport:WebSocket},auth:{autoRefreshToken:false,persistSession:false}});
    // Confirmed shared account; the administrator chooses its password privately.
    const {data:created,error}=await admin.auth.admin.createUser({email:fields.email,password,email_confirm:true});
    if(error||!created.user)throw new AccessError('No se pudo crear la cuenta. Comprueba si el correo ya está registrado.',400);
    try{await pgTransaction(async client=>{
      if(!(await client.query("SELECT 1 FROM perfiles_acceso WHERE auth_id=$1 AND rol='admin' AND activo AND NOT cambiar_password FOR SHARE",[actor.id])).rowCount)throw new AccessError();
      await client.query('INSERT INTO perfiles_acceso(auth_id,nombre,email,rol,cambiar_password) VALUES($1,$2,$3,$4,false)',[created.user!.id,fields.name,fields.email,fields.role]);
      await client.query('INSERT INTO auditoria_acceso(auth_id,accion,detalle) VALUES($1,$2,$3)',[actor.id,'account_created',JSON.stringify({target:created.user!.id,role:fields.role})]);
    });}catch{await admin.auth.admin.deleteUser(created.user.id);throw new AccessError('No se pudo guardar el perfil. Revisa si el nombre ya tiene cuenta.',400);}
  }else if(data.action==='update'){
    if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id)||!ROLES.includes(data.role as Role)||typeof data.active!=='boolean')throw new AccessError('Solicitud inválida.',400);
    await pgTransaction(async client=>{
      const target=(await client.query('SELECT * FROM perfiles_acceso WHERE auth_id=$1 FOR UPDATE',[data.id])).rows[0];
      if(!target)throw new AccessError('Cuenta no encontrada.',404);
      if(target.rol!==data.role)throw new AccessError('Las cuentas de área tienen permisos fijos. No se cambia su área.',400);
      accountFields({name:target.nombre,email:target.email,role:data.role});
      const count=(await client.query("SELECT count(*)::int AS n FROM perfiles_acceso WHERE rol='admin' AND activo")).rows[0].n;
      assertAccountChange(actor.id,data.id as string,data.role as Role,data.active as boolean,target.rol==='admin'&&target.activo,count);
      // Block the actor being disabled while an account mutation is in flight.
      const current=(await client.query("SELECT 1 FROM perfiles_acceso WHERE auth_id=$1 AND rol='admin' AND activo AND NOT cambiar_password FOR SHARE",[actor.id])).rowCount;
      if(!current)throw new AccessError();
      await client.query('UPDATE perfiles_acceso SET rol=$1,activo=$2,version_acceso=version_acceso+1 WHERE auth_id=$3',[data.role,data.active,data.id]);
      await client.query('INSERT INTO auditoria_acceso(auth_id,accion,detalle) VALUES($1,$2,$3)',[actor.id,'account_access_changed',JSON.stringify({target:data.id,role:data.role,active:data.active})]);
    });
  }else throw new AccessError('Operación inválida.',400);
  return Response.json({ok:true});
}catch(error){return authError(error);}}
