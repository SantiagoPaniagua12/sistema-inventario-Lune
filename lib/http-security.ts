import { createHmac } from 'node:crypto';
import { getPgPool } from './postgres';
import { AccessError } from './access';
import { isAllowedInventoryOrigin } from './request-origin';
export function assertOrigin(request: Request) { if (!isAllowedInventoryOrigin(request)) throw new AccessError('Origen no permitido.'); }
export async function readJson(request: Request, max = 32_000): Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AccessError('Se requiere JSON.',415);
  if (Number(request.headers.get('content-length')) > max) throw new AccessError('La solicitud es demasiado grande.',413);
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError('Solicitud vacía.',400);
  let size=0; const parts:Uint8Array[]=[];
  while (true) { const item = await reader.read(); if (item.done) break; size+=item.value.length; if(size>max){await reader.cancel();throw new AccessError('La solicitud es demasiado grande.',413);} parts.push(item.value); }
  let data:unknown; try { data=JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new AccessError('JSON inválido.',400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccessError('Solicitud inválida.',400);
  return data as Record<string,unknown>;
}
export async function rateLimit(scope: string, identity: string, limit: number, seconds: number) {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length<32) throw new AccessError('Falta configurar la protección de acceso.',503);
  const key=createHmac('sha256',secret).update(`${scope}:${identity}`).digest('hex');
  const result=await getPgPool().query(`INSERT INTO limites_acceso(clave,intentos,vence_en) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(clave) DO UPDATE SET intentos=CASE WHEN limites_acceso.vence_en<=now() THEN 1 ELSE limites_acceso.intentos+1 END, vence_en=CASE WHEN limites_acceso.vence_en<=now() THEN now()+$2*interval '1 second' ELSE limites_acceso.vence_en END RETURNING intentos`,[key,seconds]);
  if(result.rows[0].intentos>limit) throw new AccessError('Demasiados intentos. Espera unos minutos antes de continuar.',429);
}
export function requestSource(request:Request) {
  // Only trust the platform-owned client IP header, never arbitrary X-Forwarded-For.
  return process.env.NETLIFY==='true' ? request.headers.get('x-nf-client-connection-ip') || 'unknown' : 'shared';
}
