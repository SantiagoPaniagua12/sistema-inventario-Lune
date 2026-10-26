import type {PoolClient} from 'pg';
import {WAITERS} from './staff';
import {personKey} from './inventory';
/** Registration metadata only: Supabase Auth accounts and permissions are separate. */
export async function reconcileWaiterRoster(client:PoolClient,apply=false){
 if(apply)await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
 const people=(await client.query('SELECT id_usuario,nombre_usuario,rol,activo FROM usuarios'+(apply?' FOR UPDATE':''))).rows;
 const results: {name:string;id:number|null;role:string|null;active:boolean;action:string}[]=[];
 for(const name of WAITERS){
  const matches=people.filter(person=>personKey(person.nombre_usuario)===personKey(name));
  if(matches.length>1)throw new Error(`Hay responsables duplicados para ${name}. Se requiere revisión.`);
  const person=matches[0];
  if(!person){
   const id=apply?(await client.query("INSERT INTO usuarios(nombre_usuario,password_hash,rol,activo) VALUES($1,'!','mostrador',true) RETURNING id_usuario",[name])).rows[0].id_usuario:null;
   results.push({name,id,role:apply?'mostrador':null,active:apply,action:apply?'Creado en Salón':'Sin registro'});continue;
  }
  const needsArea=person.rol!=='mostrador',needsActivation=!person.activo;
  if(needsArea&&person.rol!=='registro'){
   const refs=(await client.query(`SELECT (SELECT count(*) FROM lotes WHERE creado_por=$1)+(SELECT count(*) FROM movimiento_inventario WHERE id_usuario=$1)+(SELECT count(*) FROM turnos WHERE id_responsable=$1)+(SELECT count(*) FROM turno_responsables WHERE id_usuario=$1) AS total`,[person.id_usuario])).rows[0];
   if(Number(refs.total)>0)throw new Error(`${name} tiene registros de otra área que requieren revisión. No se modificó su historial.`);
  }
  if(apply&&(needsArea||needsActivation))await client.query("UPDATE usuarios SET rol='mostrador',activo=true WHERE id_usuario=$1",[person.id_usuario]);
  results.push({name,id:person.id_usuario,role:apply?'mostrador':person.rol,active:apply?true:person.activo,action:needsArea?(apply?'Área corregida a Salón':'Área incorrecta'):needsActivation?(apply?'Responsable activado':'Inactivo'):'Correcto'});
 }
 return results;
}
