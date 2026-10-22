import { isAllowedInventoryOrigin } from '@/lib/request-origin';
import { readExcel } from '@/lib/excel-reader';
import { requireAdmin, authError } from '@/lib/auth';
import { AccessError } from '@/lib/access';
import { rateLimit } from '@/lib/http-security';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(!isAllowedInventoryOrigin(request)) return Response.json({error:'Origen no permitido.'},{status:403});
  try {
    const actor=await requireAdmin();
    await rateLimit('excel',actor.id,6,60);
    if(Number(request.headers.get('content-length') ?? 0)>5_100_000) throw new Error('El Excel supera 5 MB.');
    // Bound the multipart body before parsing, including clients without Content-Length.
    const reader=request.body?.getReader();
    if(!reader) throw new Error('Selecciona un archivo Excel.');
    let size=0; const chunks:Uint8Array[]=[];
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>5_100_000){await reader.cancel();throw new Error('El Excel supera 5 MB.');}chunks.push(next.value);}
    const body=Buffer.concat(chunks);
    const form=await new Response(body,{headers:{'Content-Type':request.headers.get('content-type') ?? ''}}).formData();
    const file=form.get('file');
    if(!(file instanceof File) || !/\.xlsx$/i.test(file.name)) throw new Error('Selecciona un .xlsx. Si tienes un .xls, guárdalo como .xlsx desde Excel.');
    return Response.json({filename:file.name,sheets:await readExcel(Buffer.from(await file.arrayBuffer()))},{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error instanceof AccessError)return authError(error);return Response.json({error:'No se pudo leer el Excel. Revisa que sea un .xlsx válido de hasta 5 MB.'},{status:400});}
}
