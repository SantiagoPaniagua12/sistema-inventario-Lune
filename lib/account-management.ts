import {AREA_ACCOUNTS} from './area-accounts';
import {AccessError,ROLES,type Role} from './access';
export function accountFields(data:Record<string,unknown>) {
  const rawName=typeof data.name==='string'?data.name.trim():'';
  const role=data.role as Role;
  const name=role==='cocina'||role==='mozo'?AREA_ACCOUNTS[role].name:rawName;
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  if(!ROLES.includes(role) || !name || name.length>80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) throw new AccessError('Revisa nombre, correo y área.',400);
  if(role!=='admin'&&rawName&&rawName!==name)throw new AccessError('Se permite una cuenta compartida de Cocina y una de Salón.',400);
  return {name,role,email};
}
export function assertAccountChange(actorId:string,targetId:string,nextRole:Role,active:boolean,wasAdmin:boolean,adminCount:number) {
  if(actorId===targetId) throw new AccessError('Tu propia cuenta se administra desde otra cuenta administradora.');
  if(wasAdmin && (!active || nextRole!=='admin') && adminCount<=1) throw new AccessError('Debe quedar al menos un administrador activo.');
}
