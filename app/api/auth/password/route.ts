import { authClient, authError, requireActor } from '@/lib/auth';
import { assertOrigin, readJson, rateLimit } from '@/lib/http-security';
import { AccessError } from '@/lib/access';
import { pgTransaction } from '@/lib/postgres';
import {verifiedSessionId} from '@/lib/session-identity';
export async function POST(request:Request) {
  try {
    assertOrigin(request);
    const actor=await requireActor(true);
    await rateLimit('password',actor.id,5,900);
    const data=await readJson(request,2048);
    if(typeof data.current!=='string' || data.current.length>128 || typeof data.password!=='string' || data.password.length<12 || data.password.length>128 || data.password===data.current) throw new AccessError('Usa una contraseña nueva de 12 a 128 caracteres.',400);
    const client=await authClient();
    const {data:{user}}=await client.auth.getUser();
    if(!user?.email) throw new AccessError('Inicia sesión nuevamente.',401);
    const {data:signed,error:verify}=await client.auth.signInWithPassword({email:user.email,password:data.current});
    if(verify||!signed.session) throw new AccessError('La contraseña actual es incorrecta.',400);
    const {error}=await client.auth.updateUser({password:data.password});
    if(error) throw new AccessError('No se pudo actualizar la contraseña. Revisa los requisitos de Supabase.',400);
    await client.auth.signOut({scope:'others'});
    const sessionId=verifiedSessionId(signed.session.access_token,actor.id);
    await pgTransaction(async db=>{
      const result=await db.query('UPDATE perfiles_acceso SET cambiar_password=false,version_acceso=version_acceso+1 WHERE auth_id=$1 AND activo AND version_acceso=$2 RETURNING version_acceso',[actor.id,actor.accessVersion]);
      if(!result.rowCount)throw new AccessError('La cuenta cambió. Inicia sesión nuevamente.',401);
      await db.query('INSERT INTO sesiones_aplicacion(session_id,auth_id,version_acceso) VALUES($1,$2,$3) ON CONFLICT(session_id) DO UPDATE SET version_acceso=excluded.version_acceso',[sessionId,actor.id,result.rows[0].version_acceso]);
      await db.query('INSERT INTO auditoria_acceso(auth_id,accion) VALUES($1,$2)',[actor.id,'password_changed']);
    });
    return Response.json({ok:true});
  }catch(error){return authError(error);}
}
