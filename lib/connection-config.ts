import type { PoolConfig } from 'pg';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
export class ConnectionConfigurationError extends Error {
  constructor(message:string,public code:string){super(message);}
}
export function normalizeCertificate(value:string):string{
  let pem=value.trim().replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n');
  if((pem.startsWith('"')&&pem.endsWith('"'))||(pem.startsWith("'")&&pem.endsWith("'")))pem=pem.slice(1,-1).trim();
  // Single-line inputs may remove or replace PEM line breaks when pasted.
  // Restore only whitespace formatting; X509 validation and TLS trust stay mandatory.
  return pem.replace(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g,(_block,body:string)=>{
    const base64=body.replace(/\s/g,'');
    return `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)?.join('\n')??''}\n-----END CERTIFICATE-----`;
  });
}

export function connectionConfig(env: Record<string, string | undefined>, target: 'local' | 'supabase'): PoolConfig {
  if (target === 'supabase') {
    if (!env.SUPABASE_DATABASE_URL) throw new ConnectionConfigurationError('Falta SUPABASE_DATABASE_URL. Crea el proyecto y configura la conexión en .env.local; no envíes credenciales por el chat.','LUNE_DB_URL_MISSING');
    let uri: URL;
    try { uri = new URL(env.SUPABASE_DATABASE_URL); } catch { throw new ConnectionConfigurationError('La conexión de Supabase no tiene un formato válido.','LUNE_DB_URL_INVALID'); }
    if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.hostname || !uri.password) throw new ConnectionConfigurationError('Usa la cadena PostgreSQL completa del panel Connect de Supabase.','LUNE_DB_URL_INVALID');
    // pg reemplaza ssl si la URI incluye sslmode. Se fuerza validación del certificado.
    for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert']) uri.searchParams.delete(key);
    let ca=env.SUPABASE_SSL_CA?normalizeCertificate(env.SUPABASE_SSL_CA):undefined;
    if(!ca&&env.SUPABASE_SSL_CA_FILE){
      try{ca=normalizeCertificate(readFileSync(env.SUPABASE_SSL_CA_FILE,'utf8'));}
      catch{throw new ConnectionConfigurationError('No se puede leer el certificado indicado en SUPABASE_SSL_CA_FILE. Revisa la ruta local.','LUNE_DB_CA_FILE');}
    }
    if(ca){
      try{const certificate=new X509Certificate(ca);if(!certificate.ca || Date.parse(certificate.validTo)<=Date.now())throw new Error();}
      catch{throw new ConnectionConfigurationError('El certificado CA de Supabase no es válido o está vencido. Descárgalo desde Database Settings > SSL Configuration.','LUNE_DB_CA_INVALID');}
    }
    return { connectionString: uri.toString(), ssl: { rejectUnauthorized: true, ...(ca?{ca}:{}) }, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, application_name: 'lune-beta-02' };
  }
  if (!env.PGPASSWORD) throw new ConnectionConfigurationError('Completa PGPASSWORD en .env.local para conectar PostgreSQL local.','LUNE_DB_STORAGE_LOCAL');
  return { host: env.PGHOST || 'localhost', port: Number(env.PGPORT || 5433), database: env.PGDATABASE || 'sistemainventario', user: env.PGUSER || 'postgres', password: env.PGPASSWORD, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, options: '-c timezone=America/Lima -c search_path=public', application_name: 'lune-inventario-beta' };
}
