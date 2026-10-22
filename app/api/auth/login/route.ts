import { authClient, authError, requireActor } from '@/lib/auth';
import { assertOrigin, readJson, rateLimit, requestSource } from '@/lib/http-security';
import { AccessError } from '@/lib/access';
import { getPgPool } from '@/lib/postgres';
import {verifiedSessionId} from '@/lib/session-identity';
import {loginArea} from '@/lib/area-accounts';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    assertOrigin(request);
    const data=await readJson(request,2048);
    const identifier=typeof data.email==='string'?data.email.trim().toLowerCase():'';
    const password=typeof data.password==='string'?data.password:'';
    await rateLimit('login-source',requestSource(request),30,900);
    if(!identifier || identifier.length>254 || !password || password.length>128) throw new AccessError('Usuario o contraseña incorrectos.',401);
    const area=loginArea(identifier);
    const profile=area?(await getPgPool().query('SELECT email FROM perfiles_acceso WHERE rol=$1 AND activo',[area])).rows[0]:undefined;
    const email=area?(profile?.email||AREA_UNAVAILABLE):identifier;
    await rateLimit('login-email',email,5,900);
    if(email===AREA_UNAVAILABLE)throw new AccessError('Usuario o contraseña incorrectos.',401);
    const client=await authClient();
    const {data:signed,error}=await client.auth.signInWithPassword({email,password});
    if(error||!signed.session||!signed.user) throw new AccessError('Usuario o contraseña incorrectos.',401);
    try {
      const sessionId=verifiedSessionId(signed.session.access_token,signed.user.id);
      await getPgPool().query('INSERT INTO sesiones_aplicacion(session_id,auth_id,version_acceso) SELECT $1,auth_id,version_acceso FROM perfiles_acceso WHERE auth_id=$2 AND activo ON CONFLICT(session_id) DO NOTHING',[sessionId,signed.user.id]);
      const actor=await requireActor(true);
      await getPgPool().query('INSERT INTO auditoria_acceso(auth_id,accion) VALUES($1,$2)',[actor.id,'login']);
      return Response.json({redirect:actor.mustChangePassword?'/cuenta':'/'},{headers:{'Cache-Control':'no-store'}});
    }catch(error){await client.auth.signOut({scope:'local'});throw error;}
  }catch(error){return authError(error);}
}
const AREA_UNAVAILABLE='area-no-disponible';
