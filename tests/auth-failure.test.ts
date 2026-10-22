import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authFailure} from '../lib/auth-failure';
import {AccessError} from '../lib/access';
import {connectionConfig} from '../lib/connection-config';
test('el diagnóstico no expone credenciales ni detalles SQL del error original',()=>{
  const privateDetail='postgresql://usuario:clave-privada@servidor/base sb_secret_privada';
  for(const code of ['28P01','42501','42P01','ENOTFOUND','SELF_SIGNED_CERT_IN_CHAIN','unknown',privateDetail]){
    const result=authFailure(Object.assign(new Error(privateDetail),{code,detail:privateDetail}));
    assert.equal(result.status,503);assert.equal(JSON.stringify(result).includes(privateDetail),false);
    assert.equal(JSON.stringify(result).includes('clave-privada'),false);
  }
});
test('distingue certificados, conexión local y URL inválida sin devolver su contenido',()=>{
  for(const [env,target,expected] of [
    [{SUPABASE_DATABASE_URL:'https://equivocado.example'},'supabase','DB_URL_INVALID'],
    [{SUPABASE_DATABASE_URL:'postgresql://u:p@host/db',SUPABASE_SSL_CA:'no es un certificado'},'supabase','DB_CA_INVALID'],
    [{},'supabase','DB_URL_MISSING'],
    [{},'local','DB_STORAGE_INVALID'],
  ] as const){
    let captured:unknown;try{connectionConfig(env,target);}catch(error){captured=error;}
    assert(captured);assert.equal(authFailure(captured).code,expected);
  }
});
test('errores de acceso conservan su estado y mensaje sin diagnósticos de servidor',()=>{
  assert.deepEqual(authFailure(new AccessError('Usuario o contraseña incorrectos.',401)),{message:'Usuario o contraseña incorrectos.',status:401});
  assert.deepEqual(authFailure(new AccessError('Espera unos minutos.',429)),{message:'Espera unos minutos.',status:429});
});
