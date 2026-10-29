import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,type State,type Command} from '../lib/inventory';
import {authorizeCommand,type Actor} from '../lib/access';
import {fruitWithdrawals} from '../lib/fruit-withdrawals';
import {validateBackup} from '../lib/backup';
import {visibleInventory} from '../lib/inventory-visibility';
import {operationSummary} from '../lib/operation-history';
import {FruitWorkspace,FruitWithdrawalDialog} from '../app/components/fruit-workspace';
const salon:Actor={id:'salon',name:'Salón',role:'mozo',mustChangePassword:false};
const admin:Actor={id:'admin',name:'Administración',role:'admin',mustChangePassword:false};
const kitchen:Actor={id:'kitchen',name:'Cocina',role:'cocina',mustChangePassword:false};
const raw=(s:State,type:string,fields:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...fields});
function fixture(){let s=seed();for(const supplyId of ['fruta-0','fruta-1','fruta-2'])s=raw(s,'supplyMove',{supplyId,action:'conteo',quantity:10,responsible:'Joel'});return raw(s,'open',{date:limaDate(),period:'Mañana',responsibles:['Shalu','Karla']});}
const stock=(s:State,id='fruta-0')=>s.supplies!.find(f=>f.id===id)!.stock;
const run=(s:State,type:string,fields:Record<string,unknown>,actor=salon)=>{const c:Command={type,revision:s.revision,operationId:crypto.randomUUID(),...fields};return execute(s,authorizeCommand(actor,c,s));};
const withdraw=(s:State,quantity=5,supplyId='fruta-0')=>run(s,'supplyFruitWithdrawal',{shiftId:s.shifts[0].id,supplyId,quantity,responsible:'Shalu'});
const correct=(s:State,quantity:number,supplyId='fruta-0',extra:Record<string,unknown>={},actor=salon)=>{const root=fruitWithdrawals(s)[0];return run(s,'supplyFruitWithdrawalCorrection',{shiftId:root.shiftId,withdrawalId:root.id,withdrawalVersion:root.logs[0].id,supplyId,quantity,responsible:'Karla',reason:'Error de registro',...extra},actor);};

test('el retiro descuenta porciones, conserva postres y vincula el mozo al turno',()=>{
 const before=fixture(),s=withdraw(before,2),root=fruitWithdrawals(s)[0];
 assert.equal(stock(s),8);assert.equal(root.quantity,2);assert.equal(root.responsible,'Shalu');assert.equal(root.shiftId,s.shifts[0].id);
 assert.deepEqual(s.shifts,before.shifts);assert.deepEqual(s.movements,before.movements);assert.deepEqual(s.lots,before.lots);
 assert.equal(root.logs[0].before,10);assert.equal(root.logs[0].after,8);assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))),s);
});
test('correcciones sucesivas y anulación compensan solo la cantidad vigente y preservan el original',()=>{
 let s=withdraw(fixture()),original=structuredClone(fruitWithdrawals(s)[0].logs[0]);
 s=correct(s,3);assert.equal(stock(s),7);s=correct(s,7);assert.equal(stock(s),3);
 s=correct(s,0,'fruta-0',{cancel:true});assert.equal(stock(s),10);assert.equal(fruitWithdrawals(s)[0].quantity,0);
 assert.deepEqual(s.supplyMovements!.find(m=>m.id===original.id),original);
 assert.throws(()=>correct(s,0,'fruta-0',{cancel:true}),/No hay cambios/);
 assert.deepEqual(validateBackup(s),s);
});
test('cambiar la fruta restaura el origen y retira la nueva sin duplicar consumos',()=>{
 let s=withdraw(fixture());s=correct(s,3,'fruta-1');assert.equal(stock(s),10);assert.equal(stock(s,'fruta-1'),7);
 s=correct(s,2,'fruta-2');assert.equal(stock(s,'fruta-1'),10);assert.equal(stock(s,'fruta-2'),8);
 assert.equal(fruitWithdrawals(s)[0].supplyId,'fruta-2');assert.equal(fruitWithdrawals(s)[0].originalSupplyId,'fruta-0');
 s=correct(s,0,'fruta-2',{cancel:true});assert.equal(stock(s,'fruta-2'),10);assert.deepEqual(validateBackup(s),s);
});
test('rechaza cantidades inválidas, stock insuficiente, falta de conteo y fruta incorrecta sin escrituras parciales',()=>{
 const s=withdraw(fixture()),snapshot=structuredClone(s);
 for(const quantity of [0,-1,1.5,NaN,Infinity,11,'3',null])assert.throws(()=>withdraw(s,quantity as number));
 assert.throws(()=>withdraw(s,1,'fruta-3'),/conteo inicial/);
 assert.throws(()=>withdraw(s,1,'insumo-0'),/fruta congelada/);
 assert.throws(()=>correct(s,11,'fruta-1'),/suficientes/);
 assert.throws(()=>correct(s,3,'fruta-0',{reason:'  '}),/motivo/);
 assert.throws(()=>correct(s,3,'fruta-0',{withdrawalVersion:'old'}),/datos cambiaron/);
 assert.deepEqual(s,snapshot);
});
test('las devoluciones a frutas desactivadas se permiten pero los nuevos retiros se rechazan',()=>{
 let s=withdraw(fixture());s=raw(s,'supplyStatus',{supplyId:'fruta-0',active:false});
 s=correct(s,3);assert.equal(stock(s),7);assert.throws(()=>correct(s,4),/desactivada/);
 s=correct(s,0,'fruta-0',{cancel:true});assert.equal(stock(s),10);
});
test('Salón solo usa mozos del equipo; Cocina, identificadores inválidos y turnos ajenos no se autorizan',()=>{
 const s=fixture(),c:Command={type:'supplyFruitWithdrawal',revision:s.revision,operationId:crypto.randomUUID(),shiftId:s.shifts[0].id,supplyId:'fruta-0',quantity:1,responsible:'Shalu'};
 assert.throws(()=>authorizeCommand(kitchen,c,s),/permiso/);
 assert.throws(()=>authorizeCommand(salon,{...c,responsible:'Santiago'},s),/equipo/);
 assert.throws(()=>authorizeCommand(salon,{...c,shiftId:'unknown'},s),/Turno/);
 assert.throws(()=>authorizeCommand(salon,{...c,operationId:undefined},s),/Actualiza/);
 assert.equal(authorizeCommand(admin,c,s).responsible,'Shalu');
});
test('el cierre no descuenta de nuevo; solo Administración corrige el turno cerrado con otro abierto',()=>{
 let s=withdraw(fixture());const shiftId=s.shifts[0].id;
 s=raw(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});assert.equal(stock(s),5);
 s=raw(s,'open',{date:limaDate(),period:'Tarde',responsibles:['Shalu','Karla']});const shifts=structuredClone(s.shifts);
 assert.throws(()=>correct(s,3,'fruta-0',{allowClosed:true}),/Administración/);
 s=correct(s,3,'fruta-0',{},admin);assert.equal(stock(s),7);assert.deepEqual(s.shifts,shifts);
 assert.equal(fruitWithdrawals(s,shiftId)[0].quantity,3);assert.equal(fruitWithdrawals(s,s.shifts[1].id).length,0);
 assert.equal(fruitWithdrawals(s)[0].logs[0].responsible,'Administración');assert.equal(fruitWithdrawals(s)[0].responsible,'Shalu');
 assert.throws(()=>run(s,'supplyFruitWithdrawal',{shiftId,supplyId:'fruta-0',quantity:1,responsible:'Shalu'},admin),/Administración/);
 assert.deepEqual(validateBackup(s),s);
});
test('la versión del retiro evita sobrescribir correcciones aunque la revisión general esté actualizada',()=>{
 let s=withdraw(fixture());const version=fruitWithdrawals(s)[0].logs[0].id;
 s=correct(s,3);assert.throws(()=>correct(s,4,'fruta-0',{withdrawalVersion:version}),/datos cambiaron/);
 assert.throws(()=>raw(s,'supplyFruitWithdrawal',{revision:s.revision-1,shiftId:s.shifts[0].id,supplyId:'fruta-0',quantity:1,responsible:'Shalu'}),/datos cambiaron/);
});
test('Salón ve correcciones de Administración sobre frutas sin recibir movimientos genéricos ajenos',()=>{
 let s=withdraw(fixture());s=raw(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});s=correct(s,2,'fruta-1',{},admin);
 const view=visibleInventory(s,salon,new Set());assert.equal(fruitWithdrawals(view)[0].quantity,2);assert.equal(fruitWithdrawals(view)[0].supplyId,'fruta-1');
 assert(view.supplyMovements!.every(m=>m.withdrawalId));assert.equal(visibleInventory(s,kitchen,new Set()).supplyMovements!.length,0);
});
test('historial y respaldos conservan el turno y rechazan referencias falsas',()=>{
 const before=withdraw(fixture()),s=correct(before,3);
 const summary=operationSummary(before,s,{type:'supplyFruitWithdrawalCorrection',revision:before.revision,shiftId:s.shifts[0].id,withdrawalId:fruitWithdrawals(s)[0].id,responsible:'Karla',reason:'Error'});
 assert.equal(summary.shift!.id,s.shifts[0].id);assert.deepEqual(summary.responsibles,['Karla']);assert.equal(summary.items[0].before,5);assert.equal(summary.items[0].after,3);
 const bad=structuredClone(s);bad.supplyMovements![0].withdrawalId='bad';assert.throws(()=>validateBackup(bad));
 const badShift=structuredClone(s);for(const m of badShift.supplyMovements!)if(m.shiftId)m.shiftId='bad';assert.throws(()=>validateBackup(badShift));
});
test('interfaz muestra frutas y retiros, exige motivo y permite a Administración corregir después de cerrar',()=>{
 let s=withdraw(fixture());const props={actor:salon,state:s,busy:false,error:'',onCommand:async()=>true};
 const html=renderToStaticMarkup(createElement(FruitWorkspace,props));assert(html.includes('Frutas congeladas'));assert(html.includes('5 porciones'));assert(html.includes('Anular'));assert(html.includes('Ver historial'));
 s=raw(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});
 const root=fruitWithdrawals(s)[0];const dialog=renderToStaticMarkup(createElement(FruitWithdrawalDialog,{actor:admin,state:s,shiftId:root.shiftId,form:{supplyId:root.supplyId,withdrawalId:root.id},busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 assert(dialog.includes('Motivo de corrección'));assert(dialog.includes('Corrección por Administración'));assert(!dialog.includes('name="responsible"'));
 assert(renderToStaticMarkup(createElement(FruitWorkspace,{...props,state:s})).includes('Abre un turno'));
 assert.equal(renderToStaticMarkup(createElement(FruitWorkspace,{...props,actor:kitchen})), '');
});


test('el almacenamiento JSON conserva retiros y compensaciones al recargar sin repetir un descuento',async()=>{
 const {mkdir,mkdtemp,readFile}=await import('node:fs/promises');const path=await import('node:path');
 const cwd=process.cwd(),storage=process.env.INVENTORY_STORAGE;
 await mkdir(path.join(cwd,'tmp'),{recursive:true});const directory=await mkdtemp(path.join(cwd,'tmp','fruit-json-'));
 process.chdir(directory);process.env.INVENTORY_STORAGE='json';
 try{
  const {mutate,getState}=await import('../lib/store');
  let s=await mutate({type:'restore',revision:0,backup:fixture()});
  const c:Command={type:'supplyFruitWithdrawal',revision:s.revision,operationId:crypto.randomUUID(),shiftId:s.shifts[0].id,supplyId:'fruta-0',quantity:5,responsible:'Shalu'};
  s=await mutate(authorizeCommand(salon,c,s));assert.equal(stock(await getState()),5);
  await assert.rejects(()=>mutate(c),/datos cambiaron/);assert.equal(stock(await getState()),5);
  const root=fruitWithdrawals(s)[0];
  const correction:Command={type:'supplyFruitWithdrawalCorrection',revision:s.revision,operationId:crypto.randomUUID(),shiftId:root.shiftId,withdrawalId:root.id,withdrawalVersion:root.logs[0].id,supplyId:'fruta-1',quantity:3,responsible:'Karla',reason:'Era mango'};
  s=await mutate(authorizeCommand(salon,correction,s));
  const persisted=await getState();assert.equal(stock(persisted),10);assert.equal(stock(persisted,'fruta-1'),7);
  assert.deepEqual(validateBackup(JSON.parse(await readFile(path.join(directory,'data','inventory.json'),'utf8'))),s);
 }finally{process.chdir(cwd);if(storage===undefined)delete process.env.INVENTORY_STORAGE;else process.env.INVENTORY_STORAGE=storage;}
});
