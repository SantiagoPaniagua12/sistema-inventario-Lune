import {loadEnvConfig} from '@next/env';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getPgPool,databaseError} from '../lib/postgres';
import {getPostgresState,mutatePostgres} from '../lib/postgres-store';
import {limaDate} from '../lib/inventory';
import {seedSupplies} from '../lib/supplies-store';
import {insertInventorySnapshot,verifyInventorySnapshot} from '../lib/migration';
import {processShiftBackups,type BackupStorage} from '../lib/shift-backups';
import {decodeShiftBackup} from '../lib/shift-backup-format';
loadEnvConfig(process.cwd());
process.env.INVENTORY_STORAGE='postgres';process.env.SHIFT_BACKUPS_ENABLED='true';
if(!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST||'localhost'))throw new Error('Solo PostgreSQL local de pruebas.');
async function main(){
  const base=getPgPool();const schema=`lune_backup_${crypto.randomUUID().replaceAll('-','')}`;const copy=`${schema}_copy`;
  const globals=globalThis as typeof globalThis&{lunePgPool?:Pool};
  let source:Pool|undefined,target:Pool|undefined,created=false,copyCreated=false;
  async function prepare(pool:Pool,name:string){
    for(const file of ['schema.sql','002_control.sql','005_insumos.sql','007_alertas_excel.sql','012_operacion_simple.sql','013_borradores.sql','014_respaldos_turno.sql','015_catalogo_operacion.sql','016_insumos_salon.sql','017_cambio_mozo.sql','018_infusiones_decimales.sql'])await pool.query((await readFile(`database/${file}`,'utf8')).replaceAll('public.',`"${name}".`));
  }
  try{
    await base.query(`CREATE SCHEMA "${schema}"`);created=true;
    source=new Pool({...base.options,options:`-c timezone=America/Lima -c search_path=${schema}`,max:3});await prepare(source,schema);globals.lunePgPool=source;
    const c=await source.connect();try{await seedSupplies(c);}finally{c.release();}
    await source.query("INSERT INTO categorias(nombre_categoria) VALUES('Postres'),('Bollería');INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES('Congelador','congelador'),('Mostrador','mostrador')");
    let state=await getPostgresState();
    async function run(type:string,data:Record<string,unknown>={}){state=await mutatePostgres({type,revision:state.revision,...data});return state;}
    await run('createProduct',{name:'Postre de prueba',category:'Postres',yield:1,minimum:1});const productId=state.products[0].id;
    await run('produce',{productId,quantity:12,date:limaDate(),responsible:'Alex'});
    await run('open',{date:limaDate(),period:'Mañana',responsible:'Shalu',responsibles:['Shalu']});
    await run('replenish',{productId,lotId:state.lots[0].id,quantity:3});
    await assert.rejects(()=>run('close',{counts:{[productId]:99}}));
    assert.equal((await source.query('SELECT count(*)::int AS n FROM respaldos_turno')).rows[0].n,0);
    // A failure while preparing the backup must roll back the close as well.
    await source.query('ALTER TABLE respaldos_turno ADD CONSTRAINT fallo_respaldo CHECK(revision<0)');
    const before=structuredClone(state);
    await assert.rejects(()=>run('close',{counts:{[productId]:1}}));
    assert.deepEqual(await getPostgresState(),before);
    await source.query('ALTER TABLE respaldos_turno DROP CONSTRAINT fallo_respaldo');
    await run('close',{counts:{[productId]:1}});
    const closedState=structuredClone(state);
    const job=(await source.query('SELECT * FROM respaldos_turno')).rows[0];
    assert.equal(job.estado,'pendiente');assert.deepEqual(job.contenido.inventory,closedState);
    assert.equal(closedState.lots[0].quantity,9);assert.equal(closedState.shifts[0].rows[0].closing,1);
    // Operations after closure must never change the snapshot queued earlier.
    await run('produce',{productId,quantity:4,date:limaDate(),responsible:'Joel'});
    const files=new Map<string,Uint8Array>();let failAfterUpload=true;
    const storage:BackupStorage={async ensurePrivate(){},async put(path,data){if(!files.has(path))files.set(path,data);if(failAfterUpload)throw new Error('Simulación privada de fallo de red');},async get(path){return files.get(path)!;}};
    assert.deepEqual(await processShiftBackups({storage}),{saved:0,failed:1});
    assert.equal((await getPostgresState()).shifts[0].status,'closed');
    const failed=(await source.query('SELECT * FROM respaldos_turno')).rows[0];
    assert.equal(failed.ultimo_error,'BACKUP_TEMPORARY');assert(failed.contenido);assert.equal(failed.estado,'pendiente');
    failAfterUpload=false;
    const racing=await Promise.all([processShiftBackups({storage,force:true}),processShiftBackups({storage,force:true})]);
    assert.equal(racing.reduce((n,r)=>n+r.saved,0),1);assert.equal(files.size,1);
    const saved=(await source.query('SELECT * FROM respaldos_turno')).rows[0];
    assert.equal(saved.estado,'guardado');assert(saved.guardado_en);assert.equal(saved.contenido,null);
    const payload=decodeShiftBackup(files.get(job.archivo)!,job.sha256);assert.deepEqual(payload.inventory,closedState);
    await base.query(`CREATE SCHEMA "${copy}"`);copyCreated=true;
    target=new Pool({...base.options,options:`-c timezone=UTC -c search_path=${copy}`,max:2});await prepare(target,copy);
    const dest=await target.connect();try{await dest.query('BEGIN');await insertInventorySnapshot(dest,payload.tables);await verifyInventorySnapshot(dest,payload.tables);await dest.query('COMMIT');}catch(e){await dest.query('ROLLBACK');throw e;}finally{dest.release();}
    globals.lunePgPool=target;assert.deepEqual(await getPostgresState(),closedState);globals.lunePgPool=source;
    await run('correctShift',{shiftId:state.shifts[0].id,productId,incoming:3,closing:0,responsible:'Shalu',reason:'Corrección de prueba'});
    const jobs=await source.query('SELECT motivo,estado FROM respaldos_turno ORDER BY revision');assert.equal(jobs.rowCount,2);assert.equal(jobs.rows[1].motivo,'correccion');assert.equal(jobs.rows[0].estado,'guardado');
    await assert.rejects(()=>run('close',{counts:{[productId]:0}}));assert.equal((await source.query('SELECT count(*)::int AS n FROM respaldos_turno')).rows[0].n,2);
    console.log('OK: cierre/copia atómicos, fallo de subida conserva cierre, reintento idempotente, exclusión concurrente, instantánea inmutable, verificación SHA-256, recuperación exacta en otra base local y nueva copia por corrección.');
  }finally{
    globals.lunePgPool=base;await target?.end();await source?.end();
    try{if(copyCreated)await base.query(`DROP SCHEMA "${copy}" CASCADE`);if(created)await base.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await base.end();}
  }
}
main().catch(error=>{console.error('Falló la prueba aislada de respaldos; Supabase no se utiliza.');console.error(databaseError(error).message);process.exitCode=1;});
