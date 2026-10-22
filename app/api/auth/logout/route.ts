import { authClient, authError, requireActor } from '@/lib/auth';
import { assertOrigin } from '@/lib/http-security';
import { getPgPool } from '@/lib/postgres';
export async function POST(request:Request) {
  try {
    assertOrigin(request);
    const actor=await requireActor(true);
    await getPgPool().query('INSERT INTO sesiones_revocadas(session_id,auth_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.sessionId,actor.id]);
    await (await authClient()).auth.signOut({scope:'local'});
    return Response.json({ok:true});
  }catch(error){return authError(error);}
}
