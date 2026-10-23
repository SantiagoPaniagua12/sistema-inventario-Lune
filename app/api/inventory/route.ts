import { getState, mutate } from '@/lib/store';
import type { Command } from '@/lib/inventory';
import { isAllowedInventoryOrigin } from '@/lib/request-origin';
import { InventoryMaintenanceError } from '@/lib/maintenance';
import { requireActor, authError } from '@/lib/auth';
import { AccessError } from '@/lib/access';
import { readJson, rateLimit } from '@/lib/http-security';
import {after} from 'next/server';
import {backupPendingStatus,retryBackupsQuietly} from '@/lib/shift-backups';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await requireActor();
    const state=await getState();const backupStatus=await backupPendingStatus();
    after(retryBackupsQuietly);
    return Response.json(state, { headers: { 'Cache-Control': 'no-store', 'X-Shift-Backups':backupStatus, 'X-Inventory-Storage': ['postgres','supabase'].includes(process.env.INVENTORY_STORAGE ?? '') ? process.env.INVENTORY_STORAGE! : 'json' } });
  } catch (error) {
    return authError(error);
  }
}
export async function POST(request: Request) {
  if (!isAllowedInventoryOrigin(request)) return Response.json({ error: 'Origen no permitido.' }, { status: 403 });
  try {
    const actor=await requireActor();
    await rateLimit('inventory-write',actor.id,60,60);
    const command = await readJson(request,actor.role==='admin'?5_000_000:32_000) as Command;
    if (!command || typeof command !== 'object') throw new Error('Solicitud inválida.');
    const state=await mutate(command,actor);
    const backupStatus=await backupPendingStatus();
    after(retryBackupsQuietly);
    return Response.json(state,{headers:{'Cache-Control':'private, no-store','X-Shift-Backups':backupStatus}});
  } catch (error) {
    if(error instanceof AccessError)return authError(error);
    if(error instanceof InventoryMaintenanceError)return Response.json({error:error.message},{status:503,headers:{'Retry-After':'30','Cache-Control':'no-store'}});
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo guardar.' }, { status: 400 });
  }
}
