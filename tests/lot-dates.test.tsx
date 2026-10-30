import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,type State,type Command} from '../lib/inventory';
import {authorizeCommand,type Actor} from '../lib/access';
import {validateBackup} from '../lib/backup';
import {operationSummary,ACTIONS} from '../lib/operation-history';
import {visibleInventory} from '../lib/inventory-visibility';
import {OperationDialog} from '../app/components/operation-dialog';
const today=limaDate();
const day=(offset:number)=>new Date(Date.parse(`${today}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);
const run=(s:State,type:string,fields:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...fields});
const produce=(s:State,productId='p1',date=day(-3),quantity=10)=>run(s,'produce',{productId,date,quantity,responsible:'Joel'});
const correct=(s:State,lotId=s.lots[0].id,date=day(-2),fields:Record<string,unknown>={})=>run(s,'correctLotDate',{lotId,expectedDate:s.lots.find(l=>l.id===lotId)!.producedAt,date,responsible:'Joel',reason:'Fecha digitada incorrectamente',...fields});
const actor=(role:Actor['role']):Actor=>({id:role,name:role,role,mustChangePassword:false});

test('corregir fecha conserva el lote y todos los saldos y movimientos',()=>{
 const before=produce(seed()),s=correct(before);
 assert.deepEqual(s.lots,[{...before.lots[0],producedAt:day(-2)}]);assert.deepEqual(s.movements,before.movements);assert.deepEqual(s.shifts,before.shifts);assert.deepEqual(s.supplies,before.supplies);
 assert.equal(s.revision,before.revision+1);assert.equal(s.lotDateCorrections![0].previousDate,day(-3));assert.equal(s.lotDateCorrections![0].date,day(-2));assert.equal(s.lotDateCorrections![0].reason,'Fecha digitada incorrectamente');
 assert.deepEqual(validateBackup(s),s);
});
test('se puede corregir un lote parcialmente retirado o agotado sin reescribir sus salidas',()=>{
 for(const quantity of [3,10]){
  let s=produce(seed());s=run(s,'open',{date:today,period:'Mañana',responsibles:['Shalu']});s=run(s,'replenishBatch',{items:[{productId:'p1',quantity}]});
  const before=structuredClone(s);s=correct(s);assert.equal(s.lots[0].quantity,10-quantity);assert.deepEqual(s.movements,before.movements);assert.deepEqual(s.shifts,before.shifts);assert.deepEqual(validateBackup(s),s);
 }
});
test('los retiros futuros siguen la fecha corregida y los empates conservan el orden de registro',()=>{
 let s=produce(produce(seed(),'p1',day(-3)),'p1',day(-2));const first=s.lots[0].id,second=s.lots[1].id;
 s=correct(s,second,day(-4));s=run(s,'open',{date:today,period:'Mañana',responsibles:['Shalu']});
 const before=structuredClone(s);s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:1}]});assert.deepEqual(s.lots.map(l=>l.quantity),[10,9]);
 let tied=correct(before,second,day(-3));tied=run(tied,'replenishBatch',{items:[{productId:'p1',quantity:1}]});assert.equal(tied.lots.find(l=>l.id===first)!.quantity,9);assert.equal(tied.lots.find(l=>l.id===second)!.quantity,10);
});
test('cambiar fecha de bollería ordena futuros horneados sin modificar lo ya horneado',()=>{
 let s=produce(produce(seed(),'v1',day(-3)),'v1',day(-2));
 s=run(s,'bakeBatch',{items:[{productId:'v1',quantity:3}],responsible:'Joel',date:today,period:'Mañana'});const baked=structuredClone(s.baked),movements=structuredClone(s.movements),second=s.lots[1].id;
 s=correct(s,second,day(-4));assert.deepEqual(s.baked,baked);assert.deepEqual(s.movements,movements);
 s=run(s,'bakeBatch',{items:[{productId:'v1',quantity:2}],responsible:'Joel',date:today,period:'Mañana'});assert.deepEqual(s.lots.map(l=>l.quantity),[7,8]);assert.deepEqual(validateBackup(s),s);
});
test('valida fechas reales, no futuras, cambios efectivos, motivo y lote',()=>{
 const s=produce(seed()),before=structuredClone(s);
 for(const date of ['',day(1),'2026-02-30','2026-13-01','2026-1-1','0000-01-01',null,123])assert.throws(()=>correct(s,s.lots[0].id,date as string),/Fecha/);
 assert.throws(()=>correct(s,s.lots[0].id,day(-3)),/No hay cambios/);
 assert.throws(()=>correct(s,s.lots[0].id,day(-2),{reason:'  '}),/Motivo/);
 assert.throws(()=>correct(s,s.lots[0].id,day(-2),{reason:'x'.repeat(181)}),/Motivo/);
 assert.throws(()=>run(s,'correctLotDate',{lotId:'missing'}),/lote válido/);
 assert.deepEqual(s,before);
});
test('las revisiones y la fecha esperada evitan sobrescribir cambios ajenos',()=>{
 const s=produce(seed()),updated=correct(s);
 assert.throws(()=>correct(updated,updated.lots[0].id,day(-1),{revision:s.revision}),/datos cambiaron/);
 assert.throws(()=>correct(updated,updated.lots[0].id,day(-1),{expectedDate:s.lots[0].producedAt}),/datos cambiaron/);
});
test('solo Cocina y Administración pueden corregir con responsable e identificador válidos',()=>{
 const s=produce(seed()),command:Command={type:'correctLotDate',revision:s.revision,operationId:crypto.randomUUID(),lotId:s.lots[0].id,expectedDate:s.lots[0].producedAt,date:day(-2),responsible:'Joel',reason:'Corregir fecha',productId:'spoofed'};
 for(const role of ['admin','cocina'] as const){const a=actor(role);assert.equal(authorizeCommand(a,command,s).productId,'p1');assert.throws(()=>authorizeCommand(a,{...command,responsible:'Desconocido'},s));assert.throws(()=>authorizeCommand(a,{...command,operationId:undefined},s));}
 assert.throws(()=>authorizeCommand(actor('mozo'),command,s),/permiso/);
 assert.throws(()=>authorizeCommand({...actor('cocina'),mustChangePassword:true},command,s),/contraseña/);
 assert.equal(visibleInventory(correct(s),actor('mozo')).lotDateCorrections,undefined);
});
test('el historial describe ambas fechas sin inventar cantidades ni asociar el turno activo',()=>{
 let s=produce(seed());s=run(s,'open',{date:today,period:'Mañana',responsibles:['Shalu']});const after=correct(s);
 const summary=operationSummary(s,after,{type:'correctLotDate',revision:s.revision,lotId:s.lots[0].id,responsible:'Joel',reason:'Corregir fecha'});
 assert.equal(summary.shift,undefined);assert.equal(summary.items[0].quantity,null);assert.deepEqual(summary.responsibles,['Joel']);assert(summary.note.includes(`${day(-3)} → ${day(-2)}`));assert(summary.note.includes('Corregir fecha'));assert.equal(ACTIONS.correctLotDate.label,'Fecha de producción corregida');
});
test('respaldo conserva correcciones sucesivas, admite versiones anteriores y rechaza inconsistencias',()=>{
 const original=produce(seed());assert.deepEqual(validateBackup(original),original);const s=correct(correct(original),original.lots[0].id,day(-1));assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))),s);
 for(const mutate of [(b:State)=>{b.lotDateCorrections![0].lotId='bad';},(b:State)=>{b.lotDateCorrections![0].date=day(-8);},(b:State)=>{b.lotDateCorrections![0].previousDate=day(-9);},(b:State)=>{b.lotDateCorrections!.push(b.lotDateCorrections![0]);}]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateBackup(bad),/respaldo/);}
});
test('el formulario de fecha incluye lotes agotados y no pide cambiar cantidades',()=>{
 const s=produce(seed());s.lots[0].quantity=0;
 const render=(state:State)=>renderToStaticMarkup(createElement(OperationDialog,{kind:'correctLotDate',state,productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 const html=render(s);assert(html.includes('Modificar fecha de producción'));assert(html.includes('Agotado'));assert(html.includes('Fecha de producción correcta'));assert(html.includes('name="reason"'));assert(html.includes('Guardar fecha'));assert(!html.includes('name="quantity"'));assert(html.includes('max="'+today+'"'));
 const empty=render(seed());assert(empty.includes('Sin lotes registrados'));assert(empty.includes('disabled=""'));
});
test('almacenamiento JSON conserva fecha e historial después de recargar',async()=>{
 const {mkdir,mkdtemp}=await import('node:fs/promises'),path=await import('node:path');const cwd=process.cwd(),storage=process.env.INVENTORY_STORAGE;
 await mkdir(path.join(cwd,'tmp'),{recursive:true});const directory=await mkdtemp(path.join(cwd,'tmp','lot-dates-json-'));
 process.chdir(directory);process.env.INVENTORY_STORAGE='json';
 try{const {mutate,getState}=await import('../lib/store');let s=await mutate({type:'restore',revision:0,backup:produce(seed())});s=await mutate({type:'correctLotDate',revision:s.revision,operationId:crypto.randomUUID(),lotId:s.lots[0].id,expectedDate:s.lots[0].producedAt,date:day(-2),responsible:'Joel',reason:'Corregir fecha'});assert.deepEqual(await getState(),s);assert.deepEqual(validateBackup(s),s);}finally{process.chdir(cwd);if(storage===undefined)delete process.env.INVENTORY_STORAGE;else process.env.INVENTORY_STORAGE=storage;}
});
