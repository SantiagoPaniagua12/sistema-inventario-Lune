import {requireActor,authError} from '@/lib/auth';
import {assertOrigin,readJson,rateLimit} from '@/lib/http-security';
import {DraftConflictError,getClosingDraft,saveClosingDraft} from '@/lib/closing-drafts';
import {InventoryMaintenanceError} from '@/lib/maintenance';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  try{return Response.json(await getClosingDraft(new URL(request.url).searchParams.get('shiftId')??'',await requireActor()),{headers});}
  catch(error){return authError(error);}
}
export async function PUT(request:Request){
  try{
    assertOrigin(request);const actor=await requireActor();
    await rateLimit('closing-draft',actor.id,120,60);
    return Response.json(await saveClosingDraft(await readJson(request,100_000),actor),{headers});
  }catch(error){
    if(error instanceof DraftConflictError)return Response.json({error:error.message,...error.draft},{status:409,headers});
    if(error instanceof InventoryMaintenanceError)return Response.json({error:error.message},{status:503,headers});
    return authError(error);
  }
}
