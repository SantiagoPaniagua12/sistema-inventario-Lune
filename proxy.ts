import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {authTransport as WebSocket} from './lib/supabase-transport';
import { authConfig, authCookieOptions } from './lib/auth-config';
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${dev?' ws: wss:':''}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set('x-nonce',nonce); headers.set('Content-Security-Policy',csp);
  let response = NextResponse.next({request:{headers}});
  const config = authConfig();
  if(config) {
    const client = createServerClient(config.url,config.key,{realtime:{transport:WebSocket},cookieOptions:authCookieOptions,cookies:{
      getAll:()=>request.cookies.getAll(),
      setAll:values=>{for(const item of values) request.cookies.set(item.name,item.value); const refreshed=new Headers(headers);refreshed.set('cookie',request.cookies.toString());response=NextResponse.next({request:{headers:refreshed}}); for(const item of values) response.cookies.set(item.name,item.value,{...item.options,...authCookieOptions,maxAge:item.value?authCookieOptions.maxAge:0});},
    }});
    // Refresh only existing sessions; route handlers independently verify access and roles.
    if(request.cookies.getAll().some(c=>c.name.startsWith('sb-'))) await client.auth.getUser().catch(()=>{});
  }
  response.headers.set('Content-Security-Policy',csp);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('X-Frame-Options','DENY');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('Cache-Control','private, no-store');
  if(!dev) response.headers.set('Strict-Transport-Security','max-age=31536000');
  return response;
}
export const config = {matcher:['/((?!_next/static|_next/image|favicon.ico|images/).*)']};
