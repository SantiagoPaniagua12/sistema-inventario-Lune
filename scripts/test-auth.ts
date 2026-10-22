// Real Auth smoke test: temporary account, no inventory writes, no emails.
import {loadEnvConfig} from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {authTransport as WebSocket} from '../lib/supabase-transport';
import {Pool} from 'pg';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {connectionConfig} from '../lib/connection-config';
loadEnvConfig(process.cwd());
async function main(){
  if(process.env.AUTH_TEST_PROJECT_ALLOWED!=='true')throw new Error('La prueba de Auth solo se habilita en un proyecto separado con AUTH_TEST_PROJECT_ALLOWED=true.');
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key||!process.env.SUPABASE_ADMIN_DATABASE_URL)throw new Error('Falta la configuración privada de pruebas.');
  const sdk=createClient(url,key,{realtime:{transport:WebSocket},auth:{persistSession:false,autoRefreshToken:false}});
  const db=new Pool(connectionConfig(process.env,'supabase'));
  const maintenance=new Pool(connectionConfig({...process.env,SUPABASE_DATABASE_URL:process.env.SUPABASE_ADMIN_DATABASE_URL},'supabase'));
  const email=`seguridad-${randomUUID()}@example.invalid`,password=`Lune-${randomBytes(24).toString('hex')}`,nextPassword=`Lune-${randomBytes(24).toString('hex')}`;
  let id:string|undefined;
  const jar=new Map<string,string>();
  async function call(path:string,method='GET',body?:unknown,override?:string){
    const headers:Record<string,string>={Origin:'http://127.0.0.1:3000',Cookie:override??[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(`http://127.0.0.1:3000${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual'});
    for(const cookie of response.headers.getSetCookie()){
      const value=cookie.split(';')[0],at=value.indexOf('=');if(override===undefined)jar.set(value.slice(0,at),value.slice(at+1));
      assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=lax/i);
    }
    assert.equal(response.headers.get('cache-control')?.includes('no-store'),true);
    return response;
  }
  try{
    if((await db.query("SELECT 1 FROM perfiles_acceso WHERE rol='cocina'")).rowCount)throw new Error('El proyecto de pruebas ya tiene una cuenta de Cocina. No se modifica.');
    const created=await sdk.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error||!created.data.user)throw new Error('No se pudo crear la cuenta desechable de prueba.');
    id=created.data.user.id;
    await db.query("INSERT INTO perfiles_acceso(auth_id,nombre,email,rol,cambiar_password) VALUES($1,'Cocina',$2,'cocina',false)",[id,email]);
    assert.equal((await call('/api/auth/login','POST',{email,password})).status,200,'login');
    const originalCookies=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    const inventory=await call('/api/inventory');assert.equal(inventory.status,200);
    const state=await inventory.json();
    for(const type of ['createProduct','open','close','excelImport'])assert.equal((await call('/api/inventory','POST',{type,revision:state.revision})).status,403,`cocina blocked ${type}`);
    assert.equal((await call('/api/admin/users')).status,403);
    assert.equal((await call('/api/imports/excel/preview','POST')).status,403);
    assert.equal((await call('/api/reports/low-stock')).status,200);
    await db.query('UPDATE perfiles_acceso SET cambiar_password=true WHERE auth_id=$1',[id]);
    assert.equal((await call('/api/inventory')).status,428,'force change');
    assert.equal((await call('/api/auth/password','POST',{current:password,password:nextPassword})).status,200,'password change');
    assert.equal((await call('/api/inventory','GET',undefined,originalCookies)).status,401,'old session immediately revoked');
    assert.equal((await call('/api/inventory')).status,200,'new session active');
    const activeCookies=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    assert.equal((await call('/api/auth/logout','POST')).status,200,'logout');
    assert.ok([401,403].includes((await call('/api/inventory','GET',undefined,activeCookies)).status),'replayed cookie blocked');
    const after=await db.query('SELECT revision FROM inventario_control WHERE id=1');
    assert.equal(Number(after.rows[0].revision),state.revision,'inventory unchanged');
    console.log('OK: Auth real, cookies HttpOnly, permisos, Excel protegido, cambio obligatorio de contraseña, revocación inmediata y cierre de sesión. Sin movimientos de inventario.');
  }finally{
    if(id){
      const deleted=await sdk.auth.admin.deleteUser(id);
      if(deleted.error)throw new Error('Revisa la limpieza de la cuenta desechable de prueba.');
      await maintenance.query('DELETE FROM sesiones_revocadas WHERE auth_id=$1',[id]);
      await maintenance.query('DELETE FROM auditoria_acceso WHERE auth_id=$1',[id]);
      const emailKey=createHmac('sha256',process.env.AUTH_RATE_LIMIT_SECRET!).update(`login-email:${email}`).digest('hex');
      const keys=[emailKey,...['password','inventory-write','pdf'].map(scope=>createHmac('sha256',process.env.AUTH_RATE_LIMIT_SECRET!).update(`${scope}:${id}`).digest('hex'))];
      await maintenance.query('DELETE FROM limites_acceso WHERE clave=ANY($1::text[])',[keys]);
      assert.equal((await db.query('SELECT 1 FROM perfiles_acceso WHERE auth_id=$1',[id])).rowCount,0);
      console.log('Cuenta temporal y registros de prueba eliminados.');
    }
    await db.end();await maintenance.end();
  }
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?`Falló comprobación: ${error.message}`:'No se pudo completar la prueba de Auth. No se imprimen credenciales.');process.exitCode=1;});
