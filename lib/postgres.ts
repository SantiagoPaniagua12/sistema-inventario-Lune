import { Pool, type PoolClient } from 'pg';
import { connectionConfig } from './connection-config';
import { createHash } from 'node:crypto';

const globals = globalThis as typeof globalThis & { lunePgPool?: Pool; lunePgPoolKey?: string };
export function getPgPool(): Pool {
  const config=connectionConfig(process.env, process.env.INVENTORY_STORAGE === 'supabase' ? 'supabase' : 'local');
  const key=createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (!globals.lunePgPool || globals.lunePgPoolKey!==key) {
    const previous=globals.lunePgPool;
    globals.lunePgPool=new Pool(config);
    globals.lunePgPoolKey=key;
    // Retire the old connection after pending queries finish, keeping the web port open.
    void previous?.end().catch(()=>{});
  }
  return globals.lunePgPool;
}
export function databaseError(error: unknown): Error {
  const code = (error as { code?: string })?.code;
  if (code === '28P01' || code === '28000') return new Error('La base rechazó las credenciales. Revisa la configuración local de la conexión seleccionada.');
  if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code??'')) return new Error('No se pudo verificar el certificado TLS de Supabase. Configura el certificado CA oficial con SUPABASE_SSL_CA_FILE o SUPABASE_SSL_CA.');
  if (code === '3D000') return new Error('No se encontró la base sistemainventario. Revisa PGDATABASE.');
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || error instanceof AggregateError) return new Error('No se pudo conectar con la base. Revisa la conexión configurada para PostgreSQL local o Supabase.');
  if (code === '42P01' || code === '42703') return new Error('El esquema no está preparado. Ejecuta npm run db:check y npm run db:setup.');
  if (code === '23505') return new Error('Ya existe un registro con esos datos. Actualiza el inventario antes de intentar otra vez.');
  if (code?.startsWith('23')) return new Error('El registro no cumple las restricciones de la base de datos. Revisa los campos y sus relaciones.');
  if (code || !(error instanceof Error)) return new Error('No se pudo completar la operación en PostgreSQL.');
  return error;
}

// Todas las escrituras de esta aplicación toman el mismo bloqueo transaccional.
// También protege el control de stock cuando hay varios procesos del servidor.
export async function pgTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await getPgPool().connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261018, 5433)');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw databaseError(error);
  } finally { client?.release(); }
}
