import {requireAdmin,authError} from '@/lib/auth';
import {assertOrigin,rateLimit,readJson} from '@/lib/http-security';
import {getPgPool} from '@/lib/postgres';
import {shiftBackupsEnabled,processShiftBackups,supabaseBackupStorage} from '@/lib/shift-backups';
import {decodeShiftBackup} from '@/lib/shift-backup-format';
import {AccessError} from '@/lib/access';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  try{
    const actor=await requireAdmin();
    const id=new URL(request.url).searchParams.get('download');
    if(id){
      if(!/^[a-f0-9-]{36}$/i.test(id))throw new AccessError('Respaldo inválido.',400);
      await rateLimit('backup-download',actor.id,10,60);
      const job=(await getPgPool().query("SELECT archivo,sha256 FROM respaldos_turno WHERE id=$1 AND estado='guardado'",[id])).rows[0];
      if(!job)throw new AccessError('Ese respaldo todavía no está disponible.',404);
      const storage=supabaseBackupStorage();await storage.ensurePrivate();
      const data=await storage.get(job.archivo);decodeShiftBackup(data,job.sha256);
      return new Response(Buffer.from(data),{headers:{...headers,'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="lune-${String(job.archivo).split('/').at(-1)}"`,'X-Backup-SHA256':job.sha256}});
    }
    const result=await getPgPool().query(`SELECT id,id_turno AS "shiftId",revision,fecha::text AS date,periodo AS period,motivo AS reason,creado_en AS "createdAt",estado AS status,intentos AS attempts,ultimo_error AS "errorCode",guardado_en AS "savedAt",bytes,sha256 FROM respaldos_turno ORDER BY creado_en DESC,revision DESC LIMIT 100`);
    const counts=(await getPgPool().query("SELECT count(*) FILTER(WHERE estado='pendiente')::int AS pending,count(*) FILTER(WHERE estado='guardado')::int AS saved FROM respaldos_turno")).rows[0];
    return Response.json({enabled:shiftBackupsEnabled(),...counts,backups:result.rows},{headers});
  }catch(error){return authError(error);}
}
export async function POST(request:Request){
  try{
    assertOrigin(request);const actor=await requireAdmin();
    await rateLimit('backup-retry',actor.id,3,60);
    const body=await readJson(request,1024);
    if(body.action!=='retry')throw new AccessError('Acción inválida.',400);
    return Response.json(await processShiftBackups({force:true,limit:1}),{headers});
  }catch(error){return authError(error);}
}
