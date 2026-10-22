import { getState } from '@/lib/store';
import { lowStockPdf } from '@/lib/low-stock-pdf';
import { SUPPLY_GROUPS } from '@/lib/supplies';
import { limaDate } from '@/lib/inventory';
import { requireActor, authError } from '@/lib/auth';
import { rateLimit } from '@/lib/http-security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const actor=await requireActor();
    await rateLimit('pdf',actor.id,15,60);
    const url = new URL(request.url), group = url.searchParams.get('group') || undefined;
    if (group && !SUPPLY_GROUPS.includes(group as typeof SUPPLY_GROUPS[number])) return Response.json({error:'Categoría inválida.'},{status:400});
    const state = await getState();
    const requestedGroups = url.searchParams.get('groups')?.split('|');
    if (requestedGroups?.some(g=>!SUPPLY_GROUPS.includes(g as typeof SUPPLY_GROUPS[number]))) return Response.json({error:'Categorías inválidas.'},{status:400});
    const items = (state.supplies ?? []).filter(i=>!requestedGroups || requestedGroups.includes(i.group));
    const bytes = await lowStockPdf(items, { inclusive: url.searchParams.get('inclusive') === 'true', group });
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="lune-insumos-bajos-${limaDate()}.pdf"`,'Cache-Control':'no-store'}});
  } catch(error) { return authError(error); }
}
