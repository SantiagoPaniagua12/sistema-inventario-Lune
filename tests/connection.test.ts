import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { connectionConfig } from '../lib/connection-config';
import { getPgPool } from '../lib/postgres';
const uri='postgresql://usuario:solo-prueba@db.example:5432/postgres';
test('el certificado CA se configura sin desactivar la verificación TLS',async()=>{
  const pem=rootCertificates.find(pem=>{const certificate=new X509Certificate(pem);return certificate.ca&&Date.parse(certificate.validTo)>Date.now();})!;
  assert(pem);
  const ssl=connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA:pem.replace(/\n/g,'\\n')},'supabase').ssl as {rejectUnauthorized:boolean;ca:string};
  assert.equal(ssl.rejectUnauthorized,true);
  assert.equal(new X509Certificate(ssl.ca).fingerprint256,new X509Certificate(pem).fingerprint256);
  for(const pasted of [pem.replace(/\r?\n/g,''),pem.replace(/\r?\n/g,' '),JSON.stringify(pem),pem.replace(/\r?\n/g,'\\r\\n')]){
    const restored=connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA:pasted},'supabase').ssl as {rejectUnauthorized:boolean;ca:string};
    assert.equal(restored.rejectUnauthorized,true);
    assert.equal(new X509Certificate(restored.ca).fingerprint256,new X509Certificate(pem).fingerprint256);
  }
  assert.throws(()=>connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA:pem.replace(/[A-Za-z0-9+/]{30}/,'!contenido-corrupto!')},'supabase'),/certificado CA/);
  assert.throws(()=>connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA:'certificado incorrecto'},'supabase'),/certificado CA/);
  const directory=await mkdtemp(path.join(tmpdir(),'lune-cert-'));
  try{
    const filename=path.join(directory,'ca.crt');await writeFile(filename,pem);
    const fileSsl=connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA_FILE:filename},'supabase').ssl as {rejectUnauthorized:boolean;ca:string};
    assert.equal(fileSsl.rejectUnauthorized,true);
    assert.equal(new X509Certificate(fileSsl.ca).fingerprint256,new X509Certificate(pem).fingerprint256);
    assert.throws(()=>connectionConfig({SUPABASE_DATABASE_URL:uri,SUPABASE_SSL_CA_FILE:path.join(directory,'missing.crt')},'supabase'),/No se puede leer/);
  }finally{
    const resolved=path.resolve(directory);
    if(path.dirname(resolved)!==path.resolve(tmpdir()) || !path.basename(resolved).startsWith('lune-cert-'))throw new Error('La carpeta temporal no coincide con el destino de la prueba.');
    await rm(resolved,{recursive:true,force:true});
  }
});
test('el pool cambia de base o credenciales al cambiar la configuración sin reutilizar la conexión anterior',async()=>{
  const globals=globalThis as typeof globalThis&{lunePgPool?:Pool;lunePgPoolKey?:string};
  const originalPool=globals.lunePgPool,originalKey=globals.lunePgPoolKey;
  const names=['INVENTORY_STORAGE','PGPASSWORD','SUPABASE_DATABASE_URL','SUPABASE_SSL_CA','SUPABASE_SSL_CA_FILE'] as const;
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const created:Pool[]=[];
  try{
    delete globals.lunePgPool;delete globals.lunePgPoolKey;
    process.env.INVENTORY_STORAGE='postgres';process.env.PGPASSWORD='solo-prueba';delete process.env.SUPABASE_SSL_CA;delete process.env.SUPABASE_SSL_CA_FILE;
    const local=getPgPool();created.push(local);assert.equal(getPgPool(),local);
    process.env.INVENTORY_STORAGE='supabase';process.env.SUPABASE_DATABASE_URL=uri;
    const remote=getPgPool();created.push(remote);assert.notEqual(remote,local);assert.equal(getPgPool(),remote);
    process.env.SUPABASE_DATABASE_URL=uri.replace('solo-prueba','otra-prueba');
    const rotated=getPgPool();created.push(rotated);assert.notEqual(rotated,remote);
  }finally{
    for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
    await Promise.allSettled(created.map(pool=>pool.end()));
    globals.lunePgPool=originalPool;globals.lunePgPoolKey=originalKey;
  }
});
