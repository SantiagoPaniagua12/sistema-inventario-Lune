import {AccessError} from './access';
const configuration:Record<string,{message:string;code:string}>={
  LUNE_DB_URL_MISSING:{code:'DB_URL_MISSING',message:'Falta SUPABASE_DATABASE_URL en Netlify. Configura su valor de producción y vuelve a desplegar.'},
  LUNE_DB_URL_INVALID:{code:'DB_URL_INVALID',message:'SUPABASE_DATABASE_URL no tiene el formato correcto. Copia solo el valor completo de esa variable de .env.local, sin comillas ni el nombre de la variable.'},
  LUNE_DB_CA_FILE:{code:'DB_CA_FILE',message:'El servidor no puede leer la ruta local de SUPABASE_SSL_CA_FILE. En Netlify configura SUPABASE_SSL_CA con el contenido completo del certificado.'},
  LUNE_DB_CA_INVALID:{code:'DB_CA_INVALID',message:'SUPABASE_SSL_CA no contiene un certificado CA válido. Pega el certificado completo, incluyendo BEGIN CERTIFICATE y END CERTIFICATE, sin comillas externas.'},
  LUNE_DB_STORAGE_LOCAL:{code:'DB_STORAGE_INVALID',message:'El servidor intenta usar PostgreSQL local. En Netlify configura INVENTORY_STORAGE con el valor supabase y vuelve a desplegar.'},
};
export function authFailure(error:unknown):{message:string;status:number;code?:string}{
  if(error instanceof AccessError)return {message:error.message,status:error.status};
  const source=typeof(error as {code?:unknown})?.code==='string'?(error as {code:string}).code:'';
  if(Object.hasOwn(configuration,source))return {...configuration[source],status:503};
  if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(source))return {status:503,code:'DB_TLS_UNTRUSTED',message:'No se pudo verificar el certificado de Supabase. Revisa SUPABASE_SSL_CA en Production y vuelve a desplegar.'};
  if(['28P01','28000'].includes(source))return {status:503,code:'DB_CREDENTIALS',message:'Supabase rechazó la conexión del servidor. Revisa el valor de producción de SUPABASE_DATABASE_URL; no cambies las contraseñas de los usuarios.'};
  if(['ENOTFOUND','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT'].includes(source))return {status:503,code:'DB_UNREACHABLE',message:'El servidor no puede conectar con Supabase. Revisa que SUPABASE_DATABASE_URL corresponda al pooler de la base.'};
  if(source==='42501')return {status:503,code:'DB_PERMISSIONS',message:'La conexión de Netlify no tiene los permisos requeridos. Revisa que SUPABASE_DATABASE_URL sea la conexión limitada configurada para Lune.'};
  if(['42P01','42703'].includes(source))return {status:503,code:'DB_SCHEMA',message:'La base conectada desde Netlify no tiene el esquema esperado de Lune. Revisa SUPABASE_DATABASE_URL.'};
  return {status:503,code:'SERVER_ERROR',message:'No se pudo completar la solicitud. Intenta nuevamente.'};
}
