import type { PoolConfig } from 'pg';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

export function connectionConfig(env: Record<string, string | undefined>, target: 'local' | 'supabase'): PoolConfig {
  if (target === 'supabase') {
    if (!env.SUPABASE_DATABASE_URL) throw new Error('Falta SUPABASE_DATABASE_URL. Crea el proyecto y configura la conexión en .env.local; no envíes credenciales por el chat.');
    let uri: URL;
    try { uri = new URL(env.SUPABASE_DATABASE_URL); } catch { throw new Error('La conexión de Supabase no tiene un formato válido.'); }
    if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.hostname || !uri.password) throw new Error('Usa la cadena PostgreSQL completa del panel Connect de Supabase.');
    // pg reemplaza ssl si la URI incluye sslmode. Se fuerza validación del certificado.
    for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert']) uri.searchParams.delete(key);
    let ca=env.SUPABASE_SSL_CA?.replace(/\\n/g,'\n');
    if(!ca&&env.SUPABASE_SSL_CA_FILE){
      try{ca=readFileSync(env.SUPABASE_SSL_CA_FILE,'utf8');}
      catch{throw new Error('No se puede leer el certificado indicado en SUPABASE_SSL_CA_FILE. Revisa la ruta local.');}
    }
    if(ca){
      try{const certificate=new X509Certificate(ca);if(!certificate.ca || Date.parse(certificate.validTo)<=Date.now())throw new Error();}
      catch{throw new Error('El certificado CA de Supabase no es válido o está vencido. Descárgalo desde Database Settings > SSL Configuration.');}
    }
    return { connectionString: uri.toString(), ssl: { rejectUnauthorized: true, ...(ca?{ca}:{}) }, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, application_name: 'lune-beta-02' };
  }
  if (!env.PGPASSWORD) throw new Error('Completa PGPASSWORD en .env.local para conectar PostgreSQL local.');
  return { host: env.PGHOST || 'localhost', port: Number(env.PGPORT || 5433), database: env.PGDATABASE || 'sistemainventario', user: env.PGUSER || 'postgres', password: env.PGPASSWORD, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, options: '-c timezone=America/Lima -c search_path=public', application_name: 'lune-inventario-beta' };
}
