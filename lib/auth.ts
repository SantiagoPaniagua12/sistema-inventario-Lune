import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import {authTransport as WebSocket} from './supabase-transport';
import { getPgPool } from './postgres';
import { AccessError, type Actor } from './access';
import { authConfig, authCookieOptions } from './auth-config';
import {verifiedSessionId} from './session-identity';
import {authFailure} from './auth-failure';
export async function authClient() {
  const config = authConfig();
  if (!config) throw new AccessError('Falta configurar Supabase Auth. Consulta la guía de acceso.', 503);
  const jar = await cookies();
  return createServerClient(config.url, config.key, { realtime:{transport:WebSocket}, cookieOptions: authCookieOptions, cookies: {
    getAll: () => jar.getAll(),
    setAll: values => { for (const {name,value,options} of values) { try { jar.set(name,value,{...options,...authCookieOptions,maxAge:value?authCookieOptions.maxAge:0}); } catch { /* Proxy refreshes server-component cookies. */ } } },
  }});
}
export async function requireActor(allowPasswordChange = false): Promise<Actor & { sessionId: string; accessVersion: number }> {
  const client = await authClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new AccessError('Inicia sesión para continuar.', 401);
  // Validate this exact access token with Auth; never trust getSession's user object.
  const {data:{user},error} = await client.auth.getUser(session.access_token);
  if (error || !user) throw new AccessError('La sesión venció. Inicia sesión nuevamente.',401);
  const sessionId=verifiedSessionId(session.access_token,user.id);
  const result = await getPgPool().query(`SELECT p.*, EXISTS(SELECT 1 FROM sesiones_revocadas WHERE session_id=$2) AS revocada, EXISTS(SELECT 1 FROM sesiones_aplicacion s WHERE s.session_id=$2 AND s.auth_id=p.auth_id AND s.version_acceso=p.version_acceso) AS sesion_activa FROM perfiles_acceso p WHERE auth_id=$1`,[user.id,sessionId]);
  const profile = result.rows[0];
  if (!profile?.activo || profile.revocada) throw new AccessError('Esta cuenta no tiene acceso activo.',403);
  if(!profile.sesion_activa)throw new AccessError('La sesión fue cerrada. Inicia sesión nuevamente.',401);
  if (profile.cambiar_password && !allowPasswordChange) throw new AccessError('Primero cambia tu contraseña.',428);
  return {id:user.id,name:profile.nombre,role:profile.rol,mustChangePassword:profile.cambiar_password,sessionId,accessVersion:Number(profile.version_acceso)};
}
export async function requireAdmin() { const actor = await requireActor(); if (actor.role !== 'admin') throw new AccessError(); return actor; }
export function authError(error: unknown) {
  const failure=authFailure(error);
  // Log only an allowlisted diagnostic code: never raw driver errors, URLs or credentials.
  if(failure.code)console.error('lune.auth.failure',{code:failure.code});
  return Response.json({error:failure.message,...(failure.code?{code:failure.code}:{})},{status:failure.status,headers:{'Cache-Control':'private, no-store'}});
}
