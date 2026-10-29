import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getPgPool,databaseError} from '../lib/postgres';
import {getPostgresState,mutatePostgres} from '../lib/postgres-store';
import {limaDate,type State} from '../lib/inventory';
import type {Actor} from '../lib/access';
import {inventoryForActor,readOperationHistory} from '../lib/operation-history-store';
import {seedSupplies} from '../lib/supplies-store';
import {getClosingDraft,saveClosingDraft,DraftConflictError} from '../lib/closing-drafts';

loadEnvConfig(process.cwd());
process.env.INVENTORY_STORAGE='postgres';
if(!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST||'localhost'))throw new Error('Solo PostgreSQL local de prueba.');
async function main(){
  const pool=getPgPool();
  const schema=`lune_beta_${crypto.randomUUID().replaceAll('-','')}`;
  const globals=globalThis as typeof globalThis&{lunePgPool?:Pool};
  let isolated:Pool|undefined;
  let created=false;
  try{
    await pool.query(`CREATE SCHEMA "${schema}"`);created=true;
    isolated=new Pool({...pool.options,options:`-c timezone=America/Lima -c search_path=${schema}`,max:4});
    globals.lunePgPool=isolated;
    const sql=async(name:string)=>{await isolated!.query((await readFile(`database/${name}`,'utf8')).replaceAll('public.',`"${schema}".`));};
    for(const name of ['schema.sql','002_control.sql','005_insumos.sql','007_alertas_excel.sql'])await sql(name);
    const client=await isolated.connect();try{await seedSupplies(client);}finally{client.release();}
    await isolated.query(`CREATE TABLE perfiles_acceso(auth_id uuid PRIMARY KEY,nombre text,rol text,activo boolean,cambiar_password boolean,version_acceso integer DEFAULT 1);
      CREATE TABLE auditoria_acceso(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,auth_id uuid,accion text,detalle jsonb,creado_en timestamptz DEFAULT now());
      CREATE TABLE sesiones_revocadas(session_id uuid PRIMARY KEY,auth_id uuid);
      CREATE TABLE sesiones_aplicacion(session_id uuid PRIMARY KEY,auth_id uuid,version_acceso integer);
      CREATE TABLE limites_acceso(clave text PRIMARY KEY,intentos integer,vence_en timestamptz);
      INSERT INTO categorias(nombre_categoria) VALUES('Postres'),('Bollería');
      INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES('Congelador','congelador'),('Mostrador','mostrador');
      INSERT INTO usuarios(nombre_usuario,password_hash,rol,activo) VALUES('Shalu','!','mostrador',true);
      INSERT INTO productos(id_categoria,nombre_producto,rendimiento,stock_minimo,activo) VALUES(1,'Pistacho prueba',1,1,true),(1,'Sacher prueba',1,1,true);`);
    const yesterday=new Date(Date.parse(`${limaDate()}T12:00:00Z`)-86400000).toISOString().slice(0,10);
    await isolated.query("INSERT INTO turnos(fecha,periodo,id_responsable,estado) VALUES($1,'tarde',1,'abierto')",[yesterday]);
    await isolated.query('INSERT INTO detalle_turno(id_turno,id_producto,entrada) SELECT 1,id_producto,0 FROM productos');
    for(const name of ['012_operacion_simple.sql','013_borradores.sql','015_catalogo_operacion.sql','016_insumos_salon.sql','017_cambio_mozo.sql','019_horneados.sql'])await sql(name);
    const admin:Actor={id:crypto.randomUUID(),name:'Administración',role:'admin',mustChangePassword:false};
    const salon:Actor={id:crypto.randomUUID(),name:'Salón',role:'mozo',mustChangePassword:false};
    const cocina:Actor={id:crypto.randomUUID(),name:'Cocina',role:'cocina',mustChangePassword:false};
    for(const actor of [admin,salon,cocina])await isolated.query('INSERT INTO perfiles_acceso VALUES($1,$2,$3,true,false,1)',[actor.id,actor.name,actor.role]);
    let state:State=await getPostgresState();
    assert.deepEqual(state.shifts[0].responsibles,['Shalu']);
    const run=async(type:string,values:Record<string,unknown>,actor=salon)=>{
      state=await mutatePostgres({type,revision:state.revision,...values},actor);return state;
    };
    await run('close',{counts:{'1':0,'2':0}});
    const unchangedShifts=structuredClone(state.shifts),unchangedBaked=structuredClone(state.baked);
    const total=(productId='1')=>state.lots.filter(l=>l.productId===productId).reduce((n,l)=>n+l.quantity,0);
    const adjust=async(quantity:number,productId='1',actor=cocina)=>run('adjustReserve',{operationId:crypto.randomUUID(),productId,quantity,responsible:'Joel',reason:'Conteo físico'},actor);
    // Same date exercises FIFO's stable registration-order tie break.
    for(const quantity of [10,20])await run('produceBatch',{operationId:crypto.randomUUID(),date:limaDate(),responsible:'Joel',items:[{productId:'1',quantity}]},cocina);
    await adjust(15);assert.deepEqual(state.lots.map(l=>l.quantity),[0,15]);
    assert.deepEqual(state.lots.map(l=>l.producedQuantity),[10,20]);
    const revision=state.revision;
    const command={type:'adjustReserve',revision,operationId:crypto.randomUUID(),productId:'1',quantity:40,responsible:'Joel',reason:'Conteo revisado'};
    state=await mutatePostgres(command,cocina);
    assert.equal(total(),40);assert.deepEqual(state.lots.map(l=>l.quantity),[0,40]);
    const adjusted=structuredClone(state);await mutatePostgres(command,cocina);assert.deepEqual(await getPostgresState(),adjusted);
    await assert.rejects(()=>mutatePostgres({...command,quantity:41},cocina));
    await assert.rejects(()=>mutatePostgres({...command,operationId:crypto.randomUUID()},cocina),/cambiaron/);
    await assert.rejects(()=>adjust(0,'1',salon));
    for(const quantity of [-1,1.5,100001])await assert.rejects(()=>adjust(quantity));
    await assert.rejects(()=>run('adjustReserve',{operationId:crypto.randomUUID(),productId:'1',quantity:3,responsible:'Joel',reason:'  '},cocina));
    assert.deepEqual(await getPostgresState(),adjusted);
    await adjust(0,'1',admin);assert.equal(total(),0);
    const summary=(await readOperationHistory(new URLSearchParams(),admin,state)).entries.find(e=>e.action==='adjustReserve')!.summary;
    assert.equal(summary.items[0].before,40);assert.equal(summary.items[0].after,0);assert.equal(summary.items[0].quantity,-40);
    await adjust(9,'2');
    const initialLot=state.lots.find(l=>l.productId==='2')!;
    assert.equal(initialLot.quantity,9);assert.equal(initialLot.producedQuantity,0);assert.equal(initialLot.note,'Conteo inicial por ajuste');
    assert(!state.movements.some(m=>m.productId==='2'&&m.type==='Producción'));
    await run('correctProduction',{operationId:crypto.randomUUID(),lotId:initialLot.id,quantity:2,responsible:'Joel',reason:'Producción declarada'},cocina);
    assert.equal(total('2'),11);assert.equal(state.lots.find(l=>l.id===initialLot.id)!.producedQuantity,2);
    await adjust(3,'2');
    await adjust(1,'2');
    await assert.rejects(()=>run('correctProduction',{operationId:crypto.randomUUID(),lotId:initialLot.id,quantity:0,responsible:'Joel',reason:'Reducir más que disponible'},cocina),/ya salieron/);
    // Force a database failure on the second lot and verify that every adjustment rolls back.
    await adjust(10);await run('produceBatch',{operationId:crypto.randomUUID(),date:limaDate(),responsible:'Joel',items:[{productId:'1',quantity:10}]},cocina);
    const beforeFailure=structuredClone(state),lastLot=state.lots.at(-1)!;
    await isolated.query(`ALTER TABLE movimiento_inventario ADD CONSTRAINT fallo_ajuste CHECK(NOT(tipo='ajuste' AND sentido='salida' AND id_lote=${Number(lastLot.id)}))`);
    await assert.rejects(()=>adjust(0));assert.deepEqual(await getPostgresState(),beforeFailure);
    await isolated.query('ALTER TABLE movimiento_inventario DROP CONSTRAINT fallo_ajuste');
    await adjust(0);
    assert.deepEqual(state.shifts,unchangedShifts);assert.deepEqual(state.baked,unchangedBaked);
    assert.deepEqual(await getPostgresState(),state);
    console.log('OK: conteos absolutos, FIFO, primer conteo, producción independiente, permisos, validación, historial, reintentos, revisión y rollback en PostgreSQL aislado.');
  }finally{
    globals.lunePgPool=pool;await isolated?.end();
    try{if(created)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}
  }
}
main().catch(error=>{console.error('Falló la prueba aislada de reserva; Supabase no se utiliza.');console.error(databaseError(error).message);process.exitCode=1;});
