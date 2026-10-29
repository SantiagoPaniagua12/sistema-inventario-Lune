import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,type State} from '../lib/inventory';
import {bakedQuantity,isKitchenProduct} from '../lib/baking';
import {validateBackup} from '../lib/backup';
import {authorizeCommand,type Actor} from '../lib/access';
import {visibleInventory,canViewSection} from '../lib/inventory-visibility';
import {BakingWorkspace} from '../app/components/baking-workspace';
import {OperationDialog} from '../app/components/operation-dialog';
const date=limaDate();
const run=(s:State,type:string,data:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...data});
function fixture(){let s=seed();s.products.push({id:'f',name:'Focaccia',category:'Bollería',yield:1,minimum:1},{id:'t',name:'Pan para Tostada',category:'Bollería',yield:1,minimum:1});s=run(s,'open',{date,period:'Mañana',responsibles:['Shalu']});return s;}
const bake=(s:State,id:string,quantity:number)=>run(s,'bakeBatch',{items:[{productId:id,quantity}],responsible:'Joel',date,period:'Mañana'});
const produce=(s:State,id:string,quantity:number)=>run(s,'produce',{productId:id,quantity,responsible:'Joel',date});
test('hornear y enviar parcialmente conserva tres saldos y no duplica el retiro congelado',()=>{
 let s=fixture();s=produce(s,'v1',30);s=bake(s,'v1',10);
 assert.equal(s.lots[0].quantity,20);assert.equal(bakedQuantity(s,'v1'),10);assert.equal(s.shifts[0].rows.find(r=>r.productId==='v1')!.incoming,0);
 s=run(s,'replenishBatch',{items:[{productId:'v1',quantity:3}]});
 assert.equal(s.lots[0].quantity,20);assert.equal(bakedQuantity(s,'v1'),7);assert.equal(s.shifts[0].rows.find(r=>r.productId==='v1')!.incoming,3);
 assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))),s);
});
test('los dos panes se usan en platos del turno de Cocina sin mostrador ni dependencia del turno de Salón',()=>{
 let s=fixture();assert(!s.shifts[0].rows.some(r=>r.productId==='f'||r.productId==='t'));
 for(const id of ['f','t']){s=produce(s,id,12);s=bake(s,id,8);s=run(s,'useBaked',{productId:id,quantity:3,responsible:'Alex',date,period:'Tarde'});assert.equal(bakedQuantity(s,id),5);assert.equal(s.movements[0].serviceDate,date);assert.equal(s.movements[0].period,'Tarde');assert.equal(s.movements[0].responsible,'Alex');assert.throws(()=>run(s,'replenishBatch',{items:[{productId:id,quantity:1}]}),/platos/);}
 const counts=Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]));s=run(s,'close',{counts});
 s=run(s,'useBaked',{productId:'f',quantity:1,responsible:'Joel',date,period:'Tarde'});assert.equal(bakedQuantity(s,'f'),4);assert.deepEqual(validateBackup(s),s);
});
test('el FIFO de horneados y las correcciones devuelven al origen exacto',()=>{
 let s=fixture();s=produce(s,'v1',5);s=produce(s,'v1',6);s=bake(s,'v1',8);
 assert.deepEqual(s.lots.map(l=>l.quantity),[0,3]);s=run(s,'replenishBatch',{items:[{productId:'v1',quantity:6}]});assert.equal(bakedQuantity(s,'v1'),2);
 const shiftId=s.shifts[0].id;s=run(s,'correctShift',{shiftId,productId:'v1',incoming:3,responsible:'Shalu',reason:'Se enviaron tres'});
 assert.equal(bakedQuantity(s,'v1'),5);assert.deepEqual(s.lots.map(l=>l.quantity),[0,3]);
 s=run(s,'correctShift',{shiftId,productId:'v1',incoming:7,responsible:'Shalu',reason:'Se enviaron cuatro más'});assert.equal(bakedQuantity(s,'v1'),1);assert.deepEqual(s.lots.map(l=>l.quantity),[0,3]);assert.deepEqual(validateBackup(s),s);
});
test('valida existencias, productos, turnos, precisión y operaciones atómicas',()=>{
 let s=fixture();s=produce(s,'v1',5);s=produce(s,'f',2);const before=structuredClone(s);
 assert.throws(()=>run(s,'bakeBatch',{items:[{productId:'v1',quantity:3},{productId:'f',quantity:3}],responsible:'Joel',date,period:'Mañana'}),/congeladas/);assert.deepEqual(s,before);
 assert.throws(()=>bake(s,'v1',0.5),/entero/);assert.throws(()=>bake(s,'p1',1),/bollería/);
 s=bake(s,'v1',4);assert.throws(()=>run(s,'useBaked',{productId:'v1',quantity:1,responsible:'Joel',date,period:'Tarde'}),/Solo focaccia/);
 assert.throws(()=>run(s,'replenishBatch',{items:[{productId:'v1',quantity:5}]}),/stock/);
 assert.throws(()=>run(s,'bakeBatch',{items:[{productId:'v1',quantity:1}],responsible:'Joel',date,period:'Noche'}),/turno/);
 const bad=structuredClone(s);bad.baked![0].quantity++;assert.throws(()=>validateBackup(bad),/respaldo/);
});
test('permisos y vistas: Cocina opera horneados, Salón solo recibe disponibilidad agregada',()=>{
 let s=fixture();s=produce(s,'v1',10);s=bake(s,'v1',6);
 const cook:Actor={id:'c',name:'Cocina',role:'cocina',mustChangePassword:false},salon:Actor={...cook,id:'s',role:'mozo'};
 const command={type:'bakeBatch',revision:s.revision,items:[{productId:'v1',quantity:1}],date,period:'Mañana',responsible:'Joel',operationId:crypto.randomUUID()};
 assert.equal(authorizeCommand(cook,command,s).responsible,'Joel');assert.throws(()=>authorizeCommand(salon,command,s));
 assert.throws(()=>authorizeCommand(cook,{...command,responsible:'Shalu'},s));assert.throws(()=>authorizeCommand(cook,{...command,operationId:undefined},s));
 assert(canViewSection('cocina','Horneados'));assert(!canViewSection('mozo','Horneados'));
 const view=visibleInventory(s,salon);assert.equal(view.replenishment!.find(p=>p.productId==='v1')!.maximum,6);assert(!view.replenishment!.some(p=>p.productId==='f'));assert.equal(view.baked,undefined);
 assert.equal(visibleInventory(s,cook).baked!.length,1);
});
test('interfaz distingue horneados pendientes, uso de panes y formularios de Salón',()=>{
 const s=fixture();const html=renderToStaticMarkup(createElement(BakingWorkspace,{state:s,busy:false,error:'',onCommand:async()=>true}));
 assert(html.includes('Horneados en cocina'));assert.equal((html.match(/Usar en platos/g)||[]).length,2);assert(html.includes('HORNEADOS DEL TURNO'));
 const form=renderToStaticMarkup(createElement(OperationDialog,{kind:'replenish',state:s,productId:'v1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));assert(!form.includes('Focaccia'));assert(!form.includes('Pan para Tostada'));
 assert(isKitchenProduct({...s.products.find(p=>p.id==='f')!,name:'Renombrado',kitchenOnly:true}));
});
