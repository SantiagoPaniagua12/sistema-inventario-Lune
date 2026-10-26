import {loadEnvConfig} from '@next/env';import {Pool} from 'pg';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {getPgPool,databaseError} from '../lib/postgres';import {getPostgresState,mutatePostgres} from '../lib/postgres-store';import {reconcileWaiterRoster} from '../lib/waiter-roster';import {WAITERS} from '../lib/staff';import {limaDate,type State} from '../lib/inventory';import type {Actor} from '../lib/access';
loadEnvConfig(process.cwd());process.env.INVENTORY_STORAGE='postgres';process.env.SHIFT_BACKUPS_ENABLED='false';if(!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST||'localhost'))throw new Error('Solo PostgreSQL local de pruebas.');
async function main(){
 const base=getPgPool(),schema=`lune_waiters_${crypto.randomUUID().replaceAll('-','')}`;const globals=globalThis as typeof globalThis&{lunePgPool?:Pool};let isolated:Pool|undefined,created=false;
 try{
  await base.query(`CREATE SCHEMA "${schema}"`);created=true;isolated=new Pool({...base.options,options:`-c timezone=America/Lima -c search_path=${schema}`,max:3});globals.lunePgPool=isolated;
  for(const file of ['schema.sql','002_control.sql','005_insumos.sql','007_alertas_excel.sql','012_operacion_simple.sql','013_borradores.sql','015_catalogo_operacion.sql','016_insumos_salon.sql'])await isolated.query((await readFile('database/'+file,'utf8')).replaceAll('public.',`"${schema}".`));
  await isolated.query(`CREATE TABLE perfiles_acceso(auth_id uuid PRIMARY KEY,nombre text,rol text,activo boolean,cambiar_password boolean,version_acceso integer DEFAULT 1);CREATE TABLE auditoria_acceso(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,auth_id uuid,accion text,detalle jsonb,creado_en timestamptz DEFAULT now());INSERT INTO categorias(nombre_categoria) VALUES('Postres');INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES('Congelador','congelador'),('Mostrador','mostrador');INSERT INTO productos(id_categoria,nombre_producto,rendimiento,stock_minimo,activo) VALUES(1,'Postre de prueba',1,1,true);INSERT INTO usuarios(nombre_usuario,password_hash,rol,activo) VALUES('Santiago','!','cocina',true);`);
  for(const name of WAITERS.filter(n=>!['Santiago','Karla'].includes(n)))await isolated.query("INSERT INTO usuarios(nombre_usuario,password_hash,rol,activo) VALUES($1,'!','mostrador',true)",[name]);
  const salon:Actor={id:crypto.randomUUID(),name:'Salón',role:'mozo',mustChangePassword:false};await isolated.query('INSERT INTO perfiles_acceso VALUES($1,$2,$3,true,false,1)',[salon.id,salon.name,salon.role]);
  let state:State=await getPostgresState();const start=new Date(limaDate()+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-6);
  await assert.rejects(()=>mutatePostgres({type:'open',revision:state.revision,date:start.toISOString().slice(0,10),period:'Mañana',responsibles:['Santiago']},salon),/no pertenece a mostrador/);
  assert.deepEqual(await getPostgresState(),state);console.log('OK: reproducido el bloqueo de Santiago cuando está registrado en Cocina.');
  const client=await isolated.connect();try{await client.query('BEGIN');const fixed=await reconcileWaiterRoster(client,true);assert(fixed.every(p=>p.role==='mostrador'&&p.active));assert.equal(fixed.find(p=>p.name==='Santiago')!.id,1);assert.equal(fixed.find(p=>p.name==='Karla')!.action,'Creado en Salón');await client.query('COMMIT');}finally{client.release();}
  const run=async(type:string,data:Record<string,unknown>)=>{state=await mutatePostgres({type,revision:state.revision,...data},salon);return state;};
  for(const [index,name] of WAITERS.entries()){
   const date=new Date(start);date.setUTCDate(date.getUTCDate()+index);const day=date.toISOString().slice(0,10);
   for(const period of ['Mañana','Tarde'] as const){
    const team=period==='Mañana'?[name]:[name,WAITERS.find(n=>n!==name)!];
    await run('open',{date:day,period,responsibles:team});const shift=state.shifts.at(-1)!;assert.equal(shift.responsible,name);assert.deepEqual(shift.responsibles,team);
    const actual:{nombre_usuario:string;rol:string}=(await isolated.query('SELECT u.nombre_usuario,u.rol FROM turnos t JOIN usuarios u ON u.id_usuario=t.id_responsable WHERE t.id_turno=$1',[shift.id])).rows[0];assert.equal(actual.nombre_usuario,name);assert.equal(actual.rol,'mostrador');
    await run('close',{counts:{'1':0}});assert.equal(state.shifts.at(-1)!.status,'closed');
   }
  }
  assert.equal(state.shifts.length,14);assert.equal(state.lots.length,0);assert.equal((await isolated.query('SELECT count(*)::int n FROM movimiento_inventario')).rows[0].n,0);
  const check=await isolated.connect();try{
   await check.query('BEGIN');assert((await reconcileWaiterRoster(check,true)).every(p=>p.action==='Correcto'));await check.query('ROLLBACK');
   await check.query('BEGIN');await check.query("INSERT INTO usuarios(nombre_usuario,password_hash,rol,activo) VALUES('Santiago','!','mostrador',true)");await assert.rejects(()=>reconcileWaiterRoster(check,true),/duplicados/);await check.query('ROLLBACK');
   await check.query('BEGIN');await check.query("UPDATE usuarios SET rol='cocina' WHERE nombre_usuario='Santiago'");await assert.rejects(()=>reconcileWaiterRoster(check,true),/registros de otra área/);await check.query('ROLLBACK');
  }finally{await check.query('ROLLBACK');check.release();}
  assert.deepEqual(await getPostgresState(),state);console.log('OK: los siete mozos abren y cierran mañana y tarde (14 aperturas), con dos responsables por tarde. Reparación repetible, sin duplicados ni cambios de historial. Supabase no se utilizó para estas pruebas.');
 }finally{globals.lunePgPool=base;await isolated?.end();try{if(created)await base.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await base.end();}}
}
main().catch(error=>{console.error('Falló la verificación aislada de responsables.');console.error(databaseError(error).message);process.exitCode=1;});
