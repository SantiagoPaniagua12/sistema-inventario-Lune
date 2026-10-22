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
    const seeder = await isolated.connect();
    try { await seedSupplies(seeder); } finally { seeder.release(); }
    await isolated.query(`INSERT INTO categorias(nombre_categoria) VALUES ('Postres'),('Viennoiserie');
      INSERT INTO ubicaciones(nombre_ubicacion,tipo) VALUES ('Congelador','congelador'),('Mostrador','mostrador')`);
    let s = await getPostgresState();
    const mutate = async (type: string, data: Record<string, unknown> = {}) => {
      s = await mutatePostgres({ type, revision: s.revision, ...data });
      return s;
    };
    await mutate('createProduct', { name: 'Postre prueba', category: 'Postres', yield: 1, minimum: 4 });
    const postre = s.products[0].id;
    await mutate('createProduct', { name: 'Croissant prueba', category: 'Viennoiserie', yield: 1, minimum: 5 });
    const croissant = s.products[1].id;
    await mutate('open', { date: limaDate(), period: 'Mañana', responsible: 'Responsable de prueba', openings: { [postre]: 5 } });
    await mutate('produce', { productId: postre, quantity: 20, responsible: 'Cocina de prueba', date: limaDate() });
    assert.equal(s.lots[0].responsible, 'Cocina de prueba');
    assert.equal(s.shifts[0].responsible, 'Responsable de prueba');
    const roles = await isolated.query('SELECT rol FROM usuarios ORDER BY id_usuario');
    assert.deepEqual(roles.rows.map(r => r.rol), ['mostrador', 'cocina']);
    await assert.rejects(() => mutatePostgres({ type: 'produce', revision: s.revision, productId: postre, quantity: 1, responsible: '  RESPONSABLE DE PRUEBA ', date: limaDate() }), /distinto/);
    const lote = s.lots[0].id;
    await mutate('replenish', { productId: postre, lotId: lote, quantity: 12 });
    assert.equal(s.lots[0].quantity, 8);
    assert.equal(s.shifts[0].rows.find(r => r.productId === postre)!.incoming, 12);
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
    assert.equal(s.movements[0].responsible,'Karla');
    assert.equal(s.shifts.at(-1)!.responsible,'Otro responsable');
    const audit=(await isolated.query('SELECT detalle FROM auditoria_acceso ORDER BY id DESC')).rows;
    assert.equal(audit[0].detalle.responsable,'Karla');
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
