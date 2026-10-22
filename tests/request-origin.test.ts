import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedInventoryOrigin } from '../lib/request-origin';
function request(origin?: string, host = '127.0.0.1:3000', site?: string) {
  return new Request('http://localhost:3000/api/inventory', { method: 'POST', headers: {
    host, ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}),
  } });
}
test('acepta el origen real aunque Next reconstruya la URL con localhost', () => {
  assert.equal(isAllowedInventoryOrigin(request('http://127.0.0.1:3000')), true);
  assert.equal(isAllowedInventoryOrigin(request('http://localhost:3000', 'localhost:3000')), true);
});
test('rechaza otros dominios, puertos, protocolos y origen opaco', () => {
  for (const origin of ['http://otro.example', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000', 'null', 'http://127.0.0.1:3000/ruta']) {
    assert.equal(isAllowedInventoryOrigin(request(origin)), false, origin);
  }
  assert.equal(isAllowedInventoryOrigin(request('http://otro.example:3000', 'otro.example:3000')), false);
  assert.equal(isAllowedInventoryOrigin(request('http://127.0.0.1:3001', '127.0.0.1:3001')), false);
});
test('exige Origin y bloquea las peticiones marcadas cross-site', () => {
  assert.equal(isAllowedInventoryOrigin(request()), false);
  assert.equal(isAllowedInventoryOrigin(request(undefined, '127.0.0.1:3000', 'cross-site')), false);
  assert.equal(isAllowedInventoryOrigin(request('http://127.0.0.1:3000', '127.0.0.1:3000', 'cross-site')), false);
});

test('producción exige el origen HTTPS configurado sin comodines',()=>{
  const env=process.env as Record<string,string|undefined>,mode=env.NODE_ENV,configured=env.APP_ORIGIN;
  try{
    env.NODE_ENV='production';env.APP_ORIGIN='https://lune.example.com';
    assert.equal(isAllowedInventoryOrigin(request('https://lune.example.com')),true);
    for(const origin of ['https://otra.example.com','http://lune.example.com','https://lune.example.com/','https://lune.example.com:8443'])assert.equal(isAllowedInventoryOrigin(request(origin)),false);
    delete env.APP_ORIGIN;assert.equal(isAllowedInventoryOrigin(request('https://lune.example.com')),false);
    env.APP_ORIGIN='http://lune.example.com';assert.equal(isAllowedInventoryOrigin(request('http://lune.example.com')),false);
  }finally{if(mode===undefined)delete env.NODE_ENV;else env.NODE_ENV=mode;if(configured===undefined)delete env.APP_ORIGIN;else env.APP_ORIGIN=configured;}
});
