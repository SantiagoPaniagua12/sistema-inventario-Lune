import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,execute,limaDate,shiftTeam,type State} from '../lib/inventory';
import {authorizeCommand,type Actor} from '../lib/access';
import {validateBackup} from '../lib/backup';
const date=limaDate();
const run=(s:State,type:string,data:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...data});
const salon:Actor={id:'salon',name:'Salón',role:'mozo',mustChangePassword:false};
const kitchen:Actor={...salon,id:'kitchen',name:'Cocina',role:'cocina'};
const opened=()=>run(seed(),'open',{date,period:'Mañana',responsibles:['Shalu']});

test('equipos nuevos: mañana 1–4, tarde 2–4; incorporación sin duplicados ni quinto mozo',()=>{
  assert.throws(()=>run(seed(),'open',{date,period:'Tarde',responsibles:['Shalu']}),/entre 2 y 4/);
  assert.throws(()=>run(seed(),'open',{date,period:'Mañana',responsibles:['Shalu','Shalu']}),/repetirse/);
  assert.throws(()=>run(seed(),'open',{date,period:'Mañana',responsibles:['Intruso']}),/lista/);
  let s=opened();
  s=run(s,'addWaiters',{names:['Karla','Nicol']});
  s=run(s,'addWaiters',{names:['Emilia']});
  assert.deepEqual(shiftTeam(s.shifts[0]),['Shalu','Karla','Nicol','Emilia']);
  assert.throws(()=>run(s,'addWaiters',{names:['Diogo']}),/máximo 4/);
  assert.throws(()=>run(s,'addWaiters',{names:['Karla']}),/ya forma parte/);
  s=run(s,'close',{counts:Object.fromEntries(s.products.map(p=>[p.id,0]))});
  assert.throws(()=>run(s,'addWaiters',{names:['Diogo']}),/turno abierto/);
  s=run(s,'open',{date,period:'Tarde',responsibles:['Karla','Nicol']});
  assert.deepEqual(validateBackup(s),s);
});

test('ingreso múltiple consume varios lotes FIFO, suma por producto y confirma una sola revisión',()=>{
  let s=opened();
  s=run(s,'produceBatch',{responsible:'Joel',date,items:[{productId:'p1',quantity:2},{productId:'v1',quantity:4}]});
  s=run(s,'produceBatch',{responsible:'Alex',date,items:[{productId:'p1',quantity:5}]});
  s=run(s,'bakeBatch',{items:[{productId:'v1',quantity:4}],responsible:'Joel',date,period:'Mañana'});
  const before=structuredClone(s);
  s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:6},{productId:'v1',quantity:3}]});
  assert.equal(s.revision,before.revision+1);
  assert.deepEqual(s.lots.map(l=>l.quantity),[0,0,1]);
  assert.equal(s.shifts[0].rows.find(r=>r.productId==='p1')!.incoming,6);
  assert.equal(s.shifts[0].rows.find(r=>r.productId==='v1')!.incoming,3);
  assert.equal(new Set(s.movements.map(m=>m.id)).size,s.movements.length);
  assert(s.movements.filter(m=>!['Producción','Horneado en cocina'].includes(m.type)).every(m=>m.responsible==='Shalu'&&m.responsibles?.[0]==='Shalu'));
  assert.deepEqual(validateBackup(s),s);
  assert.deepEqual(before.lots.map(l=>l.quantity),[2,0,5]);
});

test('un producto inválido o sin stock revierte todo el ingreso y no produce registros parciales',()=>{
  let s=opened();s=run(s,'produce',{productId:'p1',quantity:5,responsible:'Joel',date});
  const before=structuredClone(s);
  assert.throws(()=>run(s,'replenishBatch',{items:[{productId:'p1',quantity:3},{productId:'p2',quantity:2}]}),/suficiente stock/);
  assert.throws(()=>run(s,'replenishBatch',{items:[{productId:'p1',quantity:1},{productId:'p1',quantity:2}]}),/repetirse/);
  assert.throws(()=>run(s,'produceBatch',{responsible:'Joel',date,items:[{productId:'p1',quantity:1},{productId:'p2',quantity:-2}]}),/entero/);
  assert.deepEqual(s,before);
});

test('corrección de producción conserva el original y nunca reduce por debajo de lo consumido',()=>{
  let s=opened();s=run(s,'produceBatch',{responsible:'Joel',date,items:[{productId:'p1',quantity:15}]});
  const lotId=s.lots[0].id;
  s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:3}]});
  s=run(s,'correctProduction',{lotId,quantity:12,responsible:'Alex',reason:'Se registraron tres de más'});
  assert.equal(s.lots[0].quantity,9);assert.equal(s.lots[0].producedQuantity,12);
  assert.equal(s.movements.find(m=>m.type==='Producción')!.quantity,15);
  assert.equal(s.movements[0].type,'Corrección de producción');assert.equal(s.movements[0].quantity,-3);
  assert.throws(()=>run(s,'correctProduction',{lotId,quantity:2,responsible:'Alex',reason:'Error'}),/ya salieron/);
  assert.deepEqual(validateBackup(s),s);
  s=run(s,'correctProduction',{lotId,quantity:20,responsible:'Joel',reason:'Revisión del registro'});
  assert.equal(s.lots[0].quantity,17);
});

test('corregir ingresos asigna reversión a lotes reales y aumentos FIFO sin selector',()=>{
  let s=opened();
  s=run(s,'produce',{productId:'p1',quantity:2,responsible:'Joel',date});
  s=run(s,'produce',{productId:'p1',quantity:5,responsible:'Joel',date});
  s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:6}]});
  s=run(s,'correctShift',{shiftId:s.shifts[0].id,productId:'p1',incoming:3,responsible:'Shalu',reason:'Digitación'});
  assert.deepEqual(s.lots.map(l=>l.quantity),[0,4]);
  assert.equal(s.shifts[0].rows[0].incoming,3);
  s=run(s,'correctShift',{shiftId:s.shifts[0].id,productId:'p1',incoming:7,responsible:'Shalu',reason:'Conteo corregido'});
  assert.deepEqual(s.lots.map(l=>l.quantity),[0,0]);
  assert.deepEqual(validateBackup(s),s);
});

test('permisos de cuentas por área y operación automática sin identidades de clientes',()=>{
  const s=opened();const operationId=crypto.randomUUID();
  for(const type of ['produceBatch','correctProduction'])assert.throws(()=>authorizeCommand(salon,{type,revision:s.revision,operationId,responsible:'Joel'},s),/permiso/);
  for(const type of ['replenishBatch','addWaiters','close'])assert.throws(()=>authorizeCommand(kitchen,{type,revision:s.revision,operationId},s),/permiso/);
  assert.throws(()=>authorizeCommand(salon,{type:'replenishBatch',revision:s.revision},s),/Actualiza/);
  const command=authorizeCommand(salon,{type:'replenishBatch',revision:s.revision,operationId,responsible:'Intruso'},s);
  assert.equal(command.responsible,'Shalu');assert.deepEqual(command.responsibles,['Shalu']);
});


test('devolver reserva es independiente del orden de movimientos y de fechas empatadas',()=>{
 for(const sameDate of [true,false]){
  let s=opened();
  const yesterday=new Date(Date.parse(`${date}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  s=run(s,'produce',{productId:'p1',quantity:2,responsible:'Joel',date:sameDate?date:yesterday});
  s=run(s,'produce',{productId:'p1',quantity:10,responsible:'Joel',date});
  s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:5}]});
  const frozen=structuredClone(s);
  for(const movements of [frozen.movements,[...frozen.movements].reverse()]){
   let corrected=run({...frozen,movements},'correctShift',{shiftId:s.shifts[0].id,productId:'p1',incoming:3,responsible:'Shalu',reason:'Dos unidades de más'});
   assert.deepEqual(corrected.lots.map(l=>l.quantity),[0,9]);
   assert.equal(corrected.shifts[0].rows[0].incoming,3);
   corrected=run(corrected,'correctShift',{shiftId:s.shifts[0].id,productId:'p1',incoming:1,responsible:'Shalu',reason:'Devolver otras dos'});
   assert.deepEqual(corrected.lots.map(l=>l.quantity),[1,10]);
   corrected=run(corrected,'correctShift',{shiftId:s.shifts[0].id,productId:'p1',incoming:5,responsible:'Shalu',reason:'Reponer otra vez'});
   assert.deepEqual(corrected.lots.map(l=>l.quantity),[0,7]);
   assert.deepEqual(validateBackup(corrected),corrected);
  }
 }
});
