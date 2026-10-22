import {AccessError} from './access';
// Call only after Supabase has authenticated this exact JWT (getUser or password sign-in).
export function verifiedSessionId(token:string,userId:string):string {
  let payload:{sub?:string;session_id?:string};
  try{payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw new AccessError('Sesión inválida.',401);}
  if(payload.sub!==userId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.session_id??''))throw new AccessError('Sesión inválida.',401);
  return payload.session_id!;
}
