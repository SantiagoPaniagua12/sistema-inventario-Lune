import {requireActor,authError} from '@/lib/auth';
import {getState} from '@/lib/store';
import {readOperationHistory} from '@/lib/operation-history-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const actor=await requireActor();return Response.json(await readOperationHistory(new URL(request.url).searchParams,actor,await getState()),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return authError(error);}
}
