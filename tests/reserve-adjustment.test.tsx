import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,sales,type State} from '../lib/inventory';
import {authorizeCommand,type Actor} from '../lib/access';
import {validateBackup} from '../lib/backup';
import {operationSummary,ACTIONS} from '../lib/operation-history';
import {stockAlerts} from '../lib/stock-alerts';
import {OperationDialog} from '../app/components/operation-dialog';
const run=(s:State,type:string,values:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...values});
const adjust=(s:State,quantity:number,productId='p1')=>run(s,'adjustReserve',{productId,quantity,responsible:'Joel',reason:'Conteo físico'});
const produce=(s:State,quantity:number)=>run(s,'produce',{productId:'p1',quantity,responsible:'Joel',date:limaDate()});
const total=(s:State)=>s.lots.filter(l=>l.productId==='p1').reduce((n,l)=>n+l.quantity,0);

test('establecer el total descuenta varios lotes FIFO, admite cero y conserva la producción',()=>{
 let s=produce(produce(seed(),10),20);const ids=s.lots.map(l=>l.id);
 s=adjust(s,15);assert.deepEqual(s.lots.map(l=>l.quantity),[0,15]);assert.deepEqual(s.lots.map(l=>l.producedQuantity),[10,20]);
 assert.equal(s.movements.filter(m=>m.type==='Ajuste de reserva').reduce((n,m)=>n+m.quantity,0),-15);
 s=adjust(s,40);assert.deepEqual(s.lots.map(l=>l.quantity),[0,40]);assert.deepEqual(s.lots.map(l=>l.id),ids);
 assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))),s);
 s=adjust(s,0);assert.equal(total(s),0);assert.deepEqual(s.lots.map(l=>l.producedQuantity),[10,20]);
 assert.deepEqual(validateBackup(s),s);
});

test('primer conteo sin turno ni lotes crea un saldo identificado sin fabricar producción',()=>{
 const s=adjust(seed(),12);assert.equal(s.lots[0].producedQuantity,0);assert.equal(s.lots[0].quantity,12);
 assert.equal(s.lots[0].note,'Conteo inicial por ajuste');assert.equal(s.lots[0].producedAt,limaDate());
 assert(!s.movements.some(m=>m.type==='Producción'));assert.equal(s.movements[0].shiftId,undefined);
 assert.deepEqual(validateBackup(s),s);
});

test('rechaza cantidades inválidas, producto inexistente, motivo vacío, falta de cambios y revisión obsoleta',()=>{
 const s=produce(seed(),10),before=structuredClone(s);
 for(const quantity of [-1,0.5,100001,NaN,Infinity,'5',null,undefined])assert.throws(()=>run(s,'adjustReserve',{productId:'p1',quantity,responsible:'Joel',reason:'Conteo'}));
 assert.throws(()=>adjust(s,10),/No hay cambios/);
 assert.throws(()=>adjust(s,1,'missing'),/producto válido/);
 for(const reason of ['', '   ','a'.repeat(181)])assert.throws(()=>run(s,'adjustReserve',{productId:'p1',quantity:1,responsible:'Joel',reason}));
 assert.throws(()=>execute(s,{type:'adjustReserve',revision:s.revision-1,productId:'p1',quantity:1,responsible:'Joel',reason:'Conteo'}),/cambiaron/);
 assert.deepEqual(s,before);
});

test('solo Administración y Cocina pueden ajustar con cocinero y operación válida',()=>{
 const command={type:'adjustReserve',revision:0,productId:'p1',quantity:12,responsible:'Joel',reason:'Conteo',operationId:crypto.randomUUID()};
 for(const role of ['admin','cocina','mozo'] as const){
  const actor:Actor={id:'actor',name:'Cuenta',role,mustChangePassword:false};
  if(role==='mozo')assert.throws(()=>authorizeCommand(actor,command,seed()),/permiso/);
  else {assert.equal(authorizeCommand(actor,command,seed()).responsible,'Joel');assert.throws(()=>authorizeCommand(actor,{...command,operationId:undefined},seed()));assert.throws(()=>authorizeCommand(actor,{...command,responsible:'Desconocido'},seed()));}
 }
});

test('ajustar reserva conserva mostrador, horneados y ventas, y actualiza alertas e historial',()=>{
 let s=produce(seed(),20);s.products[0].reserveMinimum=5;
 s=run(s,'open',{date:limaDate(),period:'Mañana',responsibles:['Shalu']});
 s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:5}]});
 s=run(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,r.productId==='p1'?2:0]))});
 s.baked=[];const before=structuredClone(s);s=adjust(s,3);
 assert.deepEqual(s.shifts,before.shifts);assert.deepEqual(s.baked,before.baked);assert.equal(sales(s.shifts[0].rows[0]),3);
 assert(stockAlerts(s).alerts.some(a=>a.section==='Reserva congelada'&&a.productId==='p1'&&a.stock===3));
 const summary=operationSummary(before,s,{type:'adjustReserve',revision:before.revision,productId:'p1',quantity:3,responsible:'Joel',reason:'Conteo físico'});
 assert.deepEqual(summary.items[0],{name:s.products[0].name,quantity:-12,unit:'unidades',before:15,after:3});
 assert.deepEqual(summary.responsibles,['Joel']);assert.equal(ACTIONS.adjustReserve.kind,'Producción');
});

test('corregir producción después de ajustes nunca deja stock negativo ni altera ajustes previos',()=>{
 let s=adjust(produce(seed(),10),3);const lotId=s.lots[0].id;
 assert.throws(()=>run(s,'correctProduction',{lotId,quantity:6,responsible:'Joel',reason:'Corregir producción'}),/ya salieron/);
 s=run(s,'correctProduction',{lotId,quantity:8,responsible:'Joel',reason:'Corregir producción'});
 assert.equal(total(s),1);assert.equal(s.lots[0].producedQuantity,8);
 s=adjust(s,20);s=run(s,'correctProduction',{lotId,quantity:0,responsible:'Joel',reason:'Corregir producción'});
 assert.equal(total(s),12);assert.equal(s.lots[0].producedQuantity,0);assert.deepEqual(validateBackup(s),s);
});

test('el formulario pide el total congelado incluso para bollería y no exige seleccionar lote',()=>{
 const s=adjust(seed(),15,'v1');s.baked=[{productId:'v1',lotId:s.lots[0].id,quantity:7,bakedAt:new Date().toISOString()}];
 const html=renderToStaticMarkup(createElement(OperationDialog,{kind:'adjustReserve',state:s,productId:'v1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 assert(html.includes('Ajustar unidades'));assert(html.includes('Total correcto'));assert(html.includes('value="15"'));
 assert(!html.includes('name="lotId"'));assert(html.includes('name="reason"'));assert(html.includes('Guardar ajuste'));
});
