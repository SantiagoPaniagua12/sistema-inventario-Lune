import {addSalonSupplies} from '../lib/salon-supplies-migration';
import {migrateCatalog} from '../lib/catalog-migration';
import {readSupplies} from '../lib/supplies-store';
import {validateSupplyBackup} from '../lib/supplies';
import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getPgPool, databaseError } from '../lib/postgres';
import { getPostgresState, mutatePostgres } from '../lib/postgres-store';
import { limaDate, sales, type State } from '../lib/inventory';
import { seedSupplies } from '../lib/supplies-store';
import { validateBackup } from '../lib/backup';
import { inventorySnapshot, insertInventorySnapshot, verifyInventorySnapshot } from '../lib/migration';
import {rateLimit} from '../lib/http-security';

loadEnvConfig(process.cwd());
// Tests must never use the active Supabase database, even after migration.
process.env.INVENTORY_STORAGE='postgres';
if(!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST||'localhost'))throw new Error('Las pruebas requieren PostgreSQL local.');
async function main() {
  const mainPool = getPgPool();
  const schema = `lune_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & { lunePgPool?: Pool };
  let isolated: Pool | undefined;
  let created = false;
  let copyPool: Pool | undefined;
  const copySchema = `${schema}_copia`;
  let copyCreated = false;
  try {
    await mainPool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    isolated = new Pool({ ...mainPool.options, options: `-c timezone=America/Lima -c search_path=${schema}`, max: 3 });
    globals.lunePgPool = isolated;
    await isolated.query(await readFile(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8'));
    await isolated.query(await readFile(path.join(process.cwd(), 'database', '002_control.sql'), 'utf8'));
    await isolated.query(await readFile(path.join(process.cwd(), 'database', '005_insumos.sql'), 'utf8'));
    await isolated.query(await readFile(path.join(process.cwd(), 'database', '007_alertas_excel.sql'), 'utf8'));
    for(const file of ['012_operacion_simple.sql','013_borradores.sql','015_catalogo_operacion.sql','016_insumos_salon.sql','017_cambio_mozo.sql'])await isolated.query((await readFile(path.join(process.cwd(),'database',file),'utf8')).replaceAll('public.',`"${schema}".`));
    const seeder = await isolated.connect();
    try { await seedSupplies(seeder); } finally { seeder.release(); }
    await isolated.query(`INSERT INTO categorias(nombre_categoria) VALUES ('Postres'),('Bollería');
      INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES ('Congelador','congelador'),('Mostrador','mostrador')`);
    let s = await getPostgresState();
    const mutate = async (type: string, data: Record<string, unknown> = {}) => {
      s = await mutatePostgres({ type, revision: s.revision, ...data });
      return s;
    };
    await mutate('createProduct', { name: 'Postre prueba', category: 'Postres', yield: 1, minimum: 4 });
    const postre = s.products[0].id;
    await mutate('createProduct', { name: 'Croissant prueba', category: 'Bollería', yield: 1, minimum: 5 });
    const croissant = s.products[1].id;
    await mutate('open', { date: limaDate(), period: 'Mañana', responsible: 'Responsable de prueba', openings: { [postre]: 5 } });
    await mutate('produce', { productId: postre, quantity: 20, responsible: 'Cocina de prueba', date: limaDate() });
    assert.equal(s.lots[0].responsible, 'Cocina de prueba');
    assert.equal(s.shifts[0].responsible, 'Responsable de prueba');
    const roles = await isolated.query('SELECT rol FROM usuarios ORDER BY id_usuario');
    assert.deepEqual(roles.rows.map(r => r.rol), ['mostrador', 'cocina']);
    await assert.rejects(() => mutatePostgres({ type: 'produce', revision: s.revision, productId: postre, quantity: 1, responsible: '  RESPONSABLE DE PRUEBA ', date: limaDate() }), /distinto/);
    const lote = s.lots[0].id;
    await mutate('replenish', { productId: postre, lotId: lote, quantity: 4 });
    assert.equal(s.shifts[0].rows.find(r => r.productId === postre)!.incoming, 4);
    assert.equal((await getPostgresState()).lots.find(l=>l.id===lote)!.quantity,16);
    await mutate('replenish', { productId: postre, lotId: lote, quantity: 8 });
    assert.equal(s.lots[0].quantity, 8);
    assert.equal(s.shifts[0].rows.find(r => r.productId === postre)!.incoming, 12);
    const persisted = await getPostgresState();
    assert.equal(persisted.shifts[0].rows.find(r => r.productId === postre)!.incoming,12);
    assert.equal(persisted.shifts[0].rows.find(r => r.productId === postre)!.opening,5);
    assert.equal(persisted.movements.filter(m=>m.shiftId===s.shifts[0].id&&m.productId===postre&&m.type==='Retiro de producción').length,2);
    console.log('OK ingresos acumulados: primer ingreso 4; segundo ingreso 8; total guardado 12. Entrada inicial 5 conservada; reserva 20 → 8; dos movimientos registrados.');
    await mutate('close', { counts: { [postre]: 4, [croissant]: 0 } });
    assert.equal(sales(s.shifts[0].rows.find(r => r.productId === postre)!), 13);
    await assert.rejects(() => mutatePostgres({ type: 'open', revision: s.revision, date: limaDate(), period: 'Tarde', responsible: 'Cocina de prueba' }), /no pertenece a mostrador/);
    await mutate('open', { date: limaDate(), period: 'Tarde', responsible: 'Otro responsable' });
    await assert.rejects(() => mutatePostgres({ type: 'produce', revision: s.revision, productId: postre, quantity: 1, responsible: 'Responsable de prueba', date: limaDate() }), /no pertenece a cocina/);
    assert.equal(s.shifts[1].rows.find(r => r.productId === postre)!.opening, 4);
    assert.deepEqual(await getPostgresState(), s);
    const balance = await isolated.query(`SELECT SUM(CASE WHEN sentido='entrada' THEN cantidad ELSE -cantidad END)::int AS n
      FROM movimiento_inventario WHERE id_producto=$1 AND unidad='pieza'
      AND id_ubicacion IN (SELECT id_ubicacion FROM ubicaciones WHERE tipo='mostrador')`, [postre]);
    assert.equal(balance.rows[0].n, 4);
    // Corrige un cierre con siguiente turno abierto y compensa ambos saldos sin borrar asientos.
    const correctedShift=s.shifts[0].id;
    await mutate('correctShift',{shiftId:correctedShift,productId:postre,lotId:lote,incoming:10,closing:3,responsible:'Responsable de prueba',reason:'Error de digitación de prueba'});
    assert.equal(s.lots[0].quantity,10);
    assert.equal(s.shifts[0].rows[0].incoming,10);
    assert.equal(s.shifts[1].rows[0].opening,3);
    await mutate('correctShift',{shiftId:correctedShift,productId:postre,incoming:10,closing:4,responsible:'Responsable de prueba',reason:'Corrección solo de cierre'});
    assert.equal(s.movements[0].type,'Corrección de cierre');
    await mutate('correctShift',{shiftId:correctedShift,productId:postre,lotId:lote,incoming:12,closing:4,responsible:'Responsable de prueba',reason:'Restablecer saldo para el resto de pruebas'});
    assert.equal(s.lots[0].quantity,8);
    assert.equal(s.shifts[1].rows[0].opening,4);
    const correctedBalance=await isolated.query("SELECT SUM(CASE WHEN sentido='entrada' THEN cantidad ELSE -cantidad END)::int AS n FROM movimiento_inventario WHERE id_producto=$1 AND id_ubicacion IN (SELECT id_ubicacion FROM ubicaciones WHERE tipo='mostrador')",[postre]);
    assert.equal(correctedBalance.rows[0].n,4);
    assert.deepEqual(validateBackup(s),s);
    // Una escritura desactualizada y una salida inválida no deben cambiar nada.
    const saved: State = structuredClone(s);
    await assert.rejects(() => mutatePostgres({ type: 'replenish', lotId: lote, revision: s.revision - 1, productId: postre, quantity: 1, note: 'No guardar' }), /datos cambiaron/);
    await assert.rejects(() => mutatePostgres({ type: 'replenish', revision: s.revision, productId: postre, lotId: lote, quantity: 9 }), /suficiente stock/);
    assert.deepEqual(await getPostgresState(), saved);
    // Dos consumos simultáneos con la misma revisión: solo uno puede confirmar.
    const concurrent = await Promise.allSettled([1, 2].map(() => mutatePostgres({ type: 'replenish', revision: s.revision, productId: postre, lotId: lote, quantity: 1 })));
    assert.equal(concurrent.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(x => x.status === 'rejected').length, 1);
    s = await getPostgresState();
    assert.equal(s.lots[0].quantity, 7);
    assert.equal(s.shifts[1].period,'Tarde');
    assert.equal(s.shifts[1].rows.find(r=>r.productId===postre)!.incoming,1);
    assert.equal(s.shifts[0].rows.find(r=>r.productId===postre)!.incoming,12);
    // Fuerza un fallo en el segundo asiento de reposición: el primero debe revertirse.
    await isolated.query(`ALTER TABLE movimiento_inventario ADD CONSTRAINT fallo_prueba
      CHECK (NOT (tipo='reposicion' AND sentido='entrada' AND cantidad=7))`);
    const beforeFailure = structuredClone(s);
    await assert.rejects(() => mutatePostgres({ type: 'replenish', revision: s.revision, productId: postre, lotId: lote, quantity: 7 }), /restricciones/);
    assert.deepEqual(await getPostgresState(), beforeFailure);
    await assert.rejects(() => mutatePostgres({type:'correctShift',revision:s.revision,shiftId:s.shifts.at(-1)!.id,productId:postre,lotId:lote,incoming:8,responsible:'Responsable de prueba',reason:'Rollback del segundo asiento'}),/restricciones/);
    assert.deepEqual(await getPostgresState(), beforeFailure);
    await mutate('supplyMove', { supplyId: 'cajas-pequenas', action: 'conteo', quantity: 0, responsible: 'Bodega' });
    await mutate('supplyMove', { supplyId: 'cajas-pequenas', action: 'entrada', quantity: 2, byPack: true, responsible: 'Bodega' });
    await mutate('supplyMove', { supplyId: 'cajas-pequenas', action: 'salida', quantity: 35, responsible: 'Bodega' });
    assert.equal(s.supplies!.find(i=>i.id==='cajas-pequenas')!.stock,1965);
    await mutate('supplyMove', { supplyId: 'fruta-5', action: 'conteo', quantity: 12, responsible: 'Bodega' });
    await mutate('supplyMove', { supplyId: 'fruta-5', action: 'salida', quantity: 2, responsible: 'Bodega' });
    await mutate('supplyMove', { supplyId: 'liquido-0', action: 'conteo', percent: 25, responsible: 'Barra' });
    assert.equal(s.supplies!.find(i=>i.id==='liquido-0')!.stock,150);
    assert.deepEqual(validateBackup(s),s);
    // Real PostgreSQL transactions: profile identity, permissions and atomic audit.
    await isolated.query(`CREATE TABLE perfiles_acceso(auth_id uuid PRIMARY KEY,nombre text,rol text,activo boolean,cambiar_password boolean);
      CREATE TABLE auditoria_acceso(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,auth_id uuid,accion text,detalle jsonb);
      CREATE TABLE limites_acceso(clave text PRIMARY KEY,intentos integer NOT NULL,vence_en timestamptz NOT NULL)`);
    const attempts=await Promise.allSettled(Array.from({length:8},()=>rateLimit('isolated-test','same-account',3,60)));
    assert.equal(attempts.filter(a=>a.status==='fulfilled').length,3);
    assert.equal(attempts.filter(a=>a.status==='rejected'&&a.reason.status===429).length,5);
    assert.equal((await isolated.query('SELECT intentos FROM limites_acceso')).rows[0].intentos,8);
    await isolated.query("UPDATE limites_acceso SET vence_en=now()-interval '1 second'");
    await rateLimit('isolated-test','same-account',3,60);
    assert.equal((await isolated.query('SELECT intentos FROM limites_acceso')).rows[0].intentos,1);
    const cookId=crypto.randomUUID(),waiterId=crypto.randomUUID();
    await isolated.query('INSERT INTO perfiles_acceso VALUES($1,$2,$3,true,false),($4,$5,$6,true,false)',[cookId,'Cocina','cocina',waiterId,'Salón','mozo']);
    const cookActor={id:cookId,name:'Nombre falsificado',role:'admin' as const,mustChangePassword:false};
    s=await mutatePostgres({type:'produce',revision:s.revision,productId:postre,quantity:2,date:limaDate(),responsible:'Joel'},cookActor);
    assert.equal(s.lots.at(-1)!.responsible,'Joel');
    assert.equal((await isolated.query('SELECT count(*)::int AS n FROM auditoria_acceso')).rows[0].n,1);
    await assert.rejects(()=>mutatePostgres({type:'product',revision:s.revision,productId:postre,name:'Intrusión',minimum:1},cookActor),/permiso/);
    await assert.rejects(()=>mutatePostgres({type:'produce',revision:s.revision,quantity:1,responsible:'Joel'},{id:waiterId,name:'Salón',role:'mozo',mustChangePassword:false}),/permiso/);
    await assert.rejects(()=>mutatePostgres({type:'replenish',revision:s.revision,productId:postre,lotId:s.lots.at(-1)!.id,quantity:1,responsible:'Karla'},{id:waiterId,name:'Salón',role:'mozo',mustChangePassword:false}),/más antiguo/);
    assert.deepEqual(await getPostgresState(),s);
    s=await mutatePostgres({type:'replenish',revision:s.revision,productId:postre,lotId:lote,quantity:1,responsible:'Karla'},{id:waiterId,name:'Salón',role:'mozo',mustChangePassword:false});
    const persistedAfternoon=await getPostgresState();
    assert.equal(persistedAfternoon.lots.find(l=>l.id===lote)!.quantity,6);
    assert.equal(persistedAfternoon.lots.at(-1)!.quantity,2);
    assert.equal(persistedAfternoon.shifts[1].rows.find(r=>r.productId===postre)!.incoming,2);
    assert.equal(persistedAfternoon.shifts[0].rows.find(r=>r.productId===postre)!.incoming,12);
    console.log('OK descuento por turno: mañana ingresa 4 + 8 y la reserva baja 20 → 16 → 8; tarde ingresa 1 + 1 y el mismo lote baja 8 → 7 → 6. Otro lote conserva sus 2 unidades. Saldos verificados al volver a leer PostgreSQL.');
    assert.equal(s.movements[0].responsible,'Otro responsable');
    assert.equal(s.shifts.at(-1)!.responsible,'Otro responsable');
    const audit=(await isolated.query('SELECT detalle FROM auditoria_acceso ORDER BY id DESC')).rows;
    assert.equal(audit[0].detalle.responsable,'Otro responsable');
    assert.equal(audit[1].detalle.responsable,'Joel');
    await assert.rejects(()=>mutatePostgres({type:'produce',revision:s.revision,productId:postre,quantity:-1,date:limaDate(),responsible:'Alex'},cookActor));
    assert.equal((await isolated.query('SELECT count(*)::int AS n FROM auditoria_acceso')).rows[0].n,2);
    assert.deepEqual(await getPostgresState(),s);
    await isolated.query('UPDATE perfiles_acceso SET activo=false WHERE auth_id=$1',[cookId]);
    await assert.rejects(()=>mutatePostgres({type:'produce',revision:s.revision,productId:postre,quantity:1,date:limaDate()},cookActor),/acceso/);
    assert.deepEqual(await getPostgresState(),s);
    const suppliesBeforeFailure=structuredClone(s);
    await isolated.query(`ALTER TABLE movimientos_insumos ADD CONSTRAINT fallo_insumo CHECK (NOT (tipo='salida' AND cantidad=13))`);
    await assert.rejects(()=>mutatePostgres({ type:'supplyMove', revision:s.revision, supplyId:'cajas-pequenas', action:'salida', quantity:13, responsible:'Bodega' }),/restricciones/);
    assert.deepEqual(await getPostgresState(),suppliesBeforeFailure);
    const requests=await Promise.allSettled([1,2].map(()=>mutatePostgres({type:'supplyMove',revision:s.revision,supplyId:'cajas-pequenas',action:'salida',quantity:1,responsible:'Bodega'})));
    assert.equal(requests.filter(x=>x.status==='fulfilled').length,1);
    s=await getPostgresState();
    assert.equal(s.supplies!.find(i=>i.id==='cajas-pequenas')!.stock,1964);
    await mutate('product',{productId:postre,name:'Postre prueba',minimum:4,reserveMinimum:10});
    assert.equal(s.products.find(p=>p.id===postre)!.reserveMinimum,10);
    const beforeExcel=structuredClone(s);
    const oldRows=[{kind:'turno',productId:postre,date:'2025-10-01',period:'Mañana',opening:10,incoming:2,closing:4,sheet:'POSTRES',row:3},
      {kind:'reserva',productId:postre,date:'2025-10-01',period:'Mañana',opening:10,produced:5,used:2,quantity:13,sheet:'RESERVA',row:3}];
    await mutate('excelImport',{filename:'historico.xlsx',importedBy:'Administración',records:oldRows});
    assert.deepEqual(s.shifts,beforeExcel.shifts);
    assert.deepEqual(s.lots,beforeExcel.lots);
    assert.deepEqual(s.movements,beforeExcel.movements);
    assert.equal(s.excelImports!.length,1);
    await assert.rejects(()=>mutatePostgres({type:'excelImport',revision:s.revision,filename:'otra-copia.xlsx',importedBy:'Administración',records:oldRows}),/ya existe/);
    assert.deepEqual(await getPostgresState(),s);
    assert.deepEqual(validateBackup(s),s);
    // Catálogo: permisos, historial y eliminación segura sobre datos aislados.
    await mutate('productStatus',{productId:postre,active:false});
    await assert.rejects(()=>mutate('productDelete',{productId:postre}),/historial|movimientos/);
    await assert.rejects(()=>mutate('produce',{productId:postre,quantity:1,responsible:'Cocina de prueba',date:limaDate()}),/desactivado/);
    await mutate('productStatus',{productId:postre,active:true});
    await mutate('createProduct',{name:'Temporal sin uso',category:'Bollería',minimum:1});
    const temporary=s.products.at(-1)!.id;await mutate('productDelete',{productId:temporary});assert(!s.products.some(p=>p.id===temporary));
    await mutate('supplyCreate',{name:'Temporal insumo',group:'Insumos',unit:'unidad',packSize:1});
    const supply=s.supplies!.find(i=>i.name==='Temporal insumo')!.id;await mutate('supplyDelete',{supplyId:supply});assert(!s.supplies!.some(i=>i.id===supply));
    const migrationClient=await isolated.connect();
    try{for(const known of [true,false]){
      await migrationClient.query('BEGIN');
      await migrationClient.query("DELETE FROM insumos WHERE id_insumo='kombuchas'");
      await migrationClient.query("UPDATE categorias SET nombre_categoria='Viennoiserie' WHERE nombre_categoria='Bollería'");
      await migrationClient.query("UPDATE insumos SET unidad='bolsa',unidades_por_paquete=1 WHERE id_insumo IN ('insumo-1','insumo-2')");
      const sourceIds=['kombucha-0','kombucha-1','kombucha-2'];
      for(const [index,id] of sourceIds.entries()){
        const count=!known&&index===2?null:3+index;
        await migrationClient.query("INSERT INTO insumos(id_insumo,nombre,categoria,unidad,stock,capacidad_ml) VALUES($1,$2,'Bebidas','botella',$3,355)",[id,'Kombucha '+index,count]);
        if(count!==null)await migrationClient.query("INSERT INTO movimientos_insumos(id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable) VALUES($1,$2,'conteo',$3,NULL,$3,'Prueba')",[crypto.randomUUID(),id,count]);
      }
      const beforeSugar=(await migrationClient.query("SELECT stock,stock_minimo FROM insumos WHERE id_insumo='insumo-1'")).rows[0];
      const first=await migrateCatalog(migrationClient);assert(first.changed);
      const data=await readSupplies(migrationClient);validateSupplyBackup(data.supplies,data.supplyMovements);
      assert.equal(data.supplies.find(i=>i.id==='kombuchas')!.stock,known?12:null);
      assert.deepEqual((await migrationClient.query("SELECT stock,stock_minimo FROM insumos WHERE id_insumo='insumo-1'")).rows[0],beforeSugar);
      assert.equal(data.supplies.find(i=>i.id==='insumo-1')!.packSize,500);
      assert(sourceIds.every(id=>data.supplies.find(i=>i.id===id)!.active===false));
      const again=await migrateCatalog(migrationClient);assert.equal(again.changed,false);
      assert.deepEqual(await readSupplies(migrationClient),data);await migrationClient.query('ROLLBACK');
    }}finally{await migrationClient.query('ROLLBACK');migrationClient.release();}
    const salonClient=await isolated.connect();
    try{
      await salonClient.query('BEGIN');
      await salonClient.query((await readFile('database/016_insumos_salon.sql','utf8')).replaceAll('public.',`"${schema}".`));
      await salonClient.query("DELETE FROM insumos WHERE id_insumo LIKE 'empaque-%' OR id_insumo LIKE 'papeleria-%'");
      await salonClient.query("INSERT INTO insumos(id_insumo,nombre,categoria,unidad,stock,stock_minimo) VALUES('bolsas-antiguas','Bolsas de papel grandes','Limpieza','unidad',17,5)");
      await salonClient.query("INSERT INTO movimientos_insumos(id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable) VALUES($1,'bolsas-antiguas','conteo',17,NULL,17,'Shalu')",[crypto.randomUUID()]);
      const oldHistory=(await salonClient.query("SELECT * FROM movimientos_insumos WHERE id_insumo='bolsas-antiguas'")).rows;
      const result=await addSalonSupplies(salonClient);assert.equal(result.added.length,11);assert.deepEqual(result.reclassified,['Bolsas de papel grandes']);
      const reused=(await salonClient.query("SELECT * FROM insumos WHERE id_insumo='bolsas-antiguas'")).rows[0];assert.equal(reused.categoria,'Empaques');assert.equal(reused.stock,17);assert.equal(reused.stock_minimo,5);
      assert.deepEqual((await salonClient.query("SELECT * FROM movimientos_insumos WHERE id_insumo='bolsas-antiguas'")).rows,oldHistory);
      assert.equal((await salonClient.query("SELECT count(*)::int n FROM insumos WHERE nombre='Bolsas de papel grandes'")).rows[0].n,1);
      assert.equal((await salonClient.query("SELECT stock FROM insumos WHERE id_insumo='papeleria-boletas'")).rows[0].stock,null);
      const again=await addSalonSupplies(salonClient);assert.equal(again.added.length,0);assert.equal(again.reclassified.length,0);
      const supplyState=await readSupplies(salonClient);validateSupplyBackup(supplyState.supplies,supplyState.supplyMovements);
      await salonClient.query('ROLLBACK');
    }finally{await salonClient.query('ROLLBACK');salonClient.release();}
    console.log('OK: insumos de salón reutilizan productos existentes y conservan conteos, mínimos e historial sin duplicados.');
    s=await getPostgresState();
    console.log('OK: eliminación sin historial, productos desactivados, migración de kombuchas con y sin conteo, sobres conservados e idempotencia.');
    // Copia completa entre dos esquemas temporales: prueba el mismo proceso usado para Supabase.
    const sourceClient=await isolated.connect();
    let snapshot;
    try { snapshot=await inventorySnapshot(sourceClient); } finally { sourceClient.release(); }
    await mainPool.query(`CREATE SCHEMA "${copySchema}"`); copyCreated=true;
    copyPool=new Pool({...mainPool.options, options:`-c timezone=UTC -c search_path=${copySchema}`,max:2});
    await copyPool.query(await readFile(path.join(process.cwd(),'database','schema.sql'),'utf8'));
    await copyPool.query(await readFile(path.join(process.cwd(),'database','002_control.sql'),'utf8'));
    await copyPool.query(await readFile(path.join(process.cwd(),'database','005_insumos.sql'),'utf8'));
    await copyPool.query(await readFile(path.join(process.cwd(),'database','007_alertas_excel.sql'),'utf8'));
    for(const file of ['012_operacion_simple.sql','013_borradores.sql','015_catalogo_operacion.sql','016_insumos_salon.sql','017_cambio_mozo.sql'])await copyPool.query((await readFile(path.join(process.cwd(),'database',file),'utf8')).replaceAll('public.',`"${copySchema}".`));
    const targetClient=await copyPool.connect();
    try {
      await targetClient.query('BEGIN');await insertInventorySnapshot(targetClient,snapshot);await verifyInventorySnapshot(targetClient,snapshot);await targetClient.query('COMMIT');
      await targetClient.query('BEGIN');
      await targetClient.query('UPDATE productos SET stock_minimo=stock_minimo+1 WHERE id_producto=$1',[postre]);
      await assert.rejects(()=>verifyInventorySnapshot(targetClient,snapshot),/no coincide/);
      await targetClient.query('ROLLBACK');
    }
    catch(error) { await targetClient.query('ROLLBACK'); throw error; } finally { targetClient.release(); }
    globals.lunePgPool=copyPool;
    assert.deepEqual(await getPostgresState(),s);
    const copied=await mutatePostgres({type:'supplyMove',revision:s.revision,supplyId:'cajas-pequenas',action:'salida',quantity:1,responsible:'Bodega'});
    assert.equal(copied.supplies!.find(i=>i.id==='cajas-pequenas')!.stock,1963);
    globals.lunePgPool=isolated;
    console.log('OK: permisos de cuentas de área, responsables seleccionados, reposición por otro mozo, desactivación, auditoría atómica, concurrencia, rollback y copia completa entre bases locales de prueba.');
  } finally {
    globals.lunePgPool = mainPool;
    await copyPool?.end();
    if(copyCreated) await mainPool.query(`DROP SCHEMA "${copySchema}" CASCADE`);
    await isolated?.end();
    try { if (created) await mainPool.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await mainPool.end(); }
  }
}
main().catch(error => {
  console.error('Falló la prueba aislada de PostgreSQL. Revisa la configuración y las restricciones de la base. No se imprimen credenciales.');
  console.error(databaseError(error).message);
  if (typeof error?.code === 'string') console.error(`Código de diagnóstico: ${error.code}`);
  if (typeof error?.code === 'string' && (error.code.startsWith('42') || error.code === 'ERR_ASSERTION')) console.error(error.message);
  process.exitCode = 1;
});
