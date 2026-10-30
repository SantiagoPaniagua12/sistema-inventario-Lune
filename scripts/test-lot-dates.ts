import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getPgPool,databaseError} from '../lib/postgres';
import {getPostgresState,mutatePostgres} from '../lib/postgres-store';
import {validateBackup} from '../lib/backup';
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
  const schema=`lune_lot_dates_${crypto.randomUUID().replaceAll('-','')}`;
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
      state=await mutatePostgres({type,revision:state.revision,operationId:crypto.randomUUID(),...values},actor);return state;
    };
    const day=(offset:number)=>new Date(Date.parse(`${limaDate()}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);
    for(const [date,quantity] of [[day(-3),5],[day(-2),10]] as const)await run('produceBatch',{date,responsible:'Joel',items:[{productId:'1',quantity}]},cocina);
    const first=state.lots[0].id,second=state.lots[1].id,before=structuredClone(state);
    const c={type:'correctLotDate',revision:state.revision,operationId:crypto.randomUUID(),lotId:second,expectedDate:day(-2),date:day(-4),responsible:'Joel',reason:'Producción del día anterior',productId:'2'};
    state=await mutatePostgres(c,cocina);
    assert.deepEqual(state.lots,before.lots.map(l=>l.id===second?{...l,producedAt:day(-4)}:l));
    assert.deepEqual(state.movements,before.movements);assert.deepEqual(state.shifts,before.shifts);assert.equal(state.lots.length,before.lots.length);
    const audit=(await isolated.query("SELECT auth_id,detalle FROM auditoria_acceso WHERE accion='inventory.correctLotDate' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(audit.auth_id,cocina.id);assert.equal(audit.detalle.previousDate,day(-2));assert.equal(audit.detalle.date,day(-4));assert.equal(audit.detalle.productId,'1');assert.equal(audit.detalle.history.shift,undefined);assert.equal(audit.detalle.history.items[0].quantity,null);
    const summary=(await readOperationHistory(new URLSearchParams(),cocina,state)).entries.find(e=>e.action==='correctLotDate')!;
    assert.equal(summary.label,'Fecha de producción corregida');assert(summary.summary.note.includes(`${day(-2)} → ${day(-4)}`));
    const persisted=structuredClone(state),audits=Number((await isolated.query("SELECT count(*) AS n FROM auditoria_acceso WHERE accion='inventory.correctLotDate'")).rows[0].n);
    await mutatePostgres(c,cocina);assert.deepEqual(await getPostgresState(),persisted);assert.equal(Number((await isolated.query("SELECT count(*) AS n FROM auditoria_acceso WHERE accion='inventory.correctLotDate'")).rows[0].n),audits);
    await assert.rejects(()=>mutatePostgres({...c,date:day(-5)},cocina));
    await assert.rejects(()=>mutatePostgres({...c,operationId:crypto.randomUUID()},cocina),/datos cambiaron/);
    const command=(lotId:string,date:string)=>({type:'correctLotDate',revision:state.revision,operationId:crypto.randomUUID(),lotId,expectedDate:state.lots.find(l=>l.id===lotId)!.producedAt,date,responsible:'Joel',reason:'Corregir fecha del lote'});
    await assert.rejects(()=>mutatePostgres(command(first,day(-1)),salon));
    await assert.rejects(()=>mutatePostgres({...command(first,day(-1)),responsible:'Desconocido'},admin));
    await assert.rejects(()=>mutatePostgres({...command(first,day(-1)),expectedDate:day(-8)},cocina),/datos cambiaron/);
    for(const date of [day(1),'2026-02-30','0000-01-01'])await assert.rejects(()=>mutatePostgres(command(first,date),cocina));
    await run('replenishBatch',{items:[{productId:'1',quantity:2}]});assert.deepEqual(state.lots.map(l=>l.quantity),[5,8]);
    state=await mutatePostgres(command(second,day(-3)),admin);
    await run('replenishBatch',{items:[{productId:'1',quantity:1}]});assert.deepEqual(state.lots.map(l=>l.quantity),[4,8]);
    const used=structuredClone(state);state=await mutatePostgres(command(first,day(-1)),cocina);assert.deepEqual(state.movements,used.movements);assert.deepEqual(state.shifts,used.shifts);
    await run('produceBatch',{date:day(-3),responsible:'Joel',items:[{productId:'2',quantity:3}]},cocina);
    const exhausted=state.lots.find(l=>l.productId==='2')!.id;
    await run('replenishBatch',{items:[{productId:'2',quantity:3}]});state=await mutatePostgres(command(exhausted,day(-2)),cocina);assert.equal(state.lots.find(l=>l.id===exhausted)!.quantity,0);
    const competing=[day(-5),day(-6)].map(date=>command(second,date));const results=await Promise.allSettled(competing.map(value=>mutatePostgres(value,cocina)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);state=await getPostgresState();
    const beforeFailure=structuredClone(state),retry=command(second,day(-7));
    const lastAudit=Number((await isolated.query('SELECT MAX(id) AS id FROM auditoria_acceso')).rows[0].id);
    await isolated.query(`ALTER TABLE auditoria_acceso ADD CONSTRAINT fallo_fecha CHECK(id<=${lastAudit} OR accion<>'inventory.correctLotDate')`);
    await assert.rejects(()=>mutatePostgres(retry,cocina));assert.deepEqual(await getPostgresState(),beforeFailure);
    await isolated.query('ALTER TABLE auditoria_acceso DROP CONSTRAINT fallo_fecha');state=await mutatePostgres(retry,cocina);assert.equal(state.lots.find(l=>l.id===second)!.producedAt,day(-7));
    await isolated.query("INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES('Horneados de prueba','horneados')");
    await run('createProduct',{name:'Croissant de prueba',category:'Bollería',minimum:1},admin);const pastry=state.products.at(-1)!;
    await run('produceBatch',{date:day(-3),responsible:'Joel',items:[{productId:pastry.id,quantity:6}]},cocina);
    await run('bakeBatch',{date:limaDate(),period:'Mañana',responsible:'Joel',items:[{productId:pastry.id,quantity:3}]},cocina);
    const bakedBefore=structuredClone(state),bakedLot=state.lots.find(l=>l.productId===pastry.id)!;
    state=await mutatePostgres(command(bakedLot.id,day(-2)),cocina);assert.deepEqual(state.baked,bakedBefore.baked);assert.deepEqual(state.movements,bakedBefore.movements);assert.deepEqual(state.shifts,bakedBefore.shifts);assert.deepEqual(validateBackup(state),state);
    // Prove the required runtime grant can be limited to this single column.
    const permissions=await isolated.connect();
    try{
      await permissions.query('BEGIN');
      const testRole=`lune_date_${crypto.randomUUID().replaceAll('-','')}`;
      await permissions.query(`CREATE ROLE "${testRole}" NOLOGIN`);
      await permissions.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${testRole}"`);
      await permissions.query(`GRANT SELECT ON "${schema}".lotes TO "${testRole}"`);
      assert.equal((await permissions.query("SELECT has_column_privilege($1,'lotes','fecha_produccion','UPDATE') AS allowed",[testRole])).rows[0].allowed,false);
      await permissions.query(`GRANT UPDATE(fecha_produccion) ON "${schema}".lotes TO "${testRole}"`);
      await permissions.query(`SET LOCAL ROLE "${testRole}"`);
      assert.equal((await permissions.query("SELECT has_column_privilege(current_user,'lotes','id_producto','UPDATE') AS allowed")).rows[0].allowed,false);
      await permissions.query('UPDATE lotes SET fecha_produccion=$1 WHERE id_lote=$2',[day(-8),first]);
    }finally{await permissions.query('ROLLBACK');permissions.release();}
    assert.deepEqual(await getPostgresState(),state);
    console.log('OK: fechas de lotes nuevos, usados, agotados y horneados, auditoría, permisos de columna, reintentos, concurrencia, FIFO y rollback sin cambiar existencias.');
  }finally{
    globals.lunePgPool=pool;await isolated?.end();
    try{if(created)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}
  }
}
main().catch(error=>{console.error('Falló la prueba aislada de fechas; Supabase no se utiliza.');console.error(databaseError(error).message);process.exitCode=1;});
