import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,type State} from '../lib/inventory';
import {closingCounts,displayQuantity,productDeletionReason,supplyDeletionReason} from '../lib/catalog';
import {dailyProductSales} from '../lib/sales-summary';
import {validateBackup} from '../lib/backup';
import {authorizeCommand,type Actor} from '../lib/access';
import {ManualCountInput} from '../app/components/manual-count-input';
import {OperationDialog} from '../app/components/operation-dialog';
import {stockAlerts} from '../lib/stock-alerts';
import {assertClosingDrafts} from '../lib/closing-drafts';
import type {PoolClient} from 'pg';
const run=(s:State,type:string,data:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...data});
const open=(s=seed())=>run(s,'open',{date:limaDate(),period:'Mañana',responsibles:['Shalu']});

test('Salida usa texto numérico y los productos sin mostrador tienen cero provisional sin guardar un conteo falso',()=>{
 const html=renderToStaticMarkup(createElement(ManualCountInput,{value:'4',onChange:()=>{},'aria-label':'Salida'}));
 assert(html.includes('type="text"'));assert(html.includes('inputMode="numeric"'));assert(!html.includes('type="number"'));
 const rows=open().shifts[0].rows,raw={};assert.equal(closingCounts(rows,raw).p1,'0');assert.deepEqual(raw,{});
 rows[0].incoming=3;assert.equal(closingCounts(rows,raw).p1,undefined);assert.equal(displayQuantity(rows[0]),3);
});
test('ingreso bloqueado con reserva cero; salida disponible si quedan unidades en mostrador',()=>{
 let s=open();s=run(s,'produce',{productId:'p1',quantity:3,date:limaDate(),responsible:'Alex'});s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:3}]});
 assert.equal(s.lots[0].quantity,0);assert.equal(closingCounts(s.shifts[0].rows,{}).p1,undefined);
 const html=renderToStaticMarkup(createElement(OperationDialog,{kind:'replenish',state:s,productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 assert.match(html,/<input disabled=""[^>]*aria-label="Ingreso al mostrador de Sacher de Tumbo"/);
 assert.throws(()=>run(s,'replenishBatch',{items:[{productId:'p1',quantity:1}]}),/suficiente/);
});
test('azúcar y stevia conservan los conteos individuales; solo los nuevos ingresos por bolsa multiplican',()=>{
 let s=seed();for(const [id,start,pack] of [['insumo-1',335,500],['insumo-2',9,100]] as const){
 s=run(s,'supplyMove',{supplyId:id,action:'conteo',quantity:start,responsible:'Shalu'});assert.equal(s.supplies!.find(i=>i.id===id)!.stock,start);
 s=run(s,'supplyMove',{supplyId:id,action:'entrada',quantity:2,byPack:true,responsible:'Shalu'});
 s=run(s,'supplyMove',{supplyId:id,action:'salida',quantity:3,responsible:'Shalu'});assert.equal(s.supplies!.find(i=>i.id===id)!.stock,start+2*pack-3);
 }assert.deepEqual(validateBackup(s),s);
});
test('desactivar conserva el turno y su stock; impide producción, conserva pendientes y permite reactivar',()=>{
 let s=open();s=run(s,'produce',{productId:'p1',quantity:3,date:limaDate(),responsible:'Alex'});s=run(s,'replenishBatch',{items:[{productId:'p1',quantity:2}]});
 const history=structuredClone(s.movements);s=run(s,'productStatus',{productId:'p1',active:false});assert.deepEqual(s.movements,history);
 assert.throws(()=>run(s,'produce',{productId:'p1',quantity:1,date:limaDate(),responsible:'Alex'}),/desactivado/);
 s=run(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,r.productId==='p1'?1:0]))});
 s=run(s,'open',{date:limaDate(),period:'Tarde',responsibles:['Shalu','Karla']});assert(s.shifts[1].rows.some(r=>r.productId==='p1'));
 assert.deepEqual(validateBackup(s),s);s=run(s,'productStatus',{productId:'p1',active:true});assert.equal(s.products[0].active,true);
});
test('desactivados sin saldo se omiten del siguiente turno; reactivación añade una fila cero',()=>{
 let s=open();s=run(s,'productStatus',{productId:'p1',active:false});s=run(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});
 s=run(s,'open',{date:limaDate(),period:'Tarde',responsibles:['Shalu','Karla']});assert(!s.shifts[1].rows.some(r=>r.productId==='p1'));assert.deepEqual(validateBackup(s),s);
 s=run(s,'productStatus',{productId:'p1',active:true});assert.equal(s.shifts[1].rows.find(r=>r.productId==='p1')?.opening,0);
});
test('solo un producto sin historial se elimina; quedan protegidos producción y turnos cerrados',()=>{
 let s=open();assert.equal(productDeletionReason(s,'p1'),null);s=run(s,'productDelete',{productId:'p1'});assert(!s.products.some(p=>p.id==='p1'));assert(!s.shifts[0].rows.some(r=>r.productId==='p1'));
 s=run(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});assert.throws(()=>run(s,'productDelete',{productId:'p2'}),/historial/);
});
test('insumos con movimientos se desactivan, conservan saldos y no admiten nuevos ingresos',()=>{
 let s=seed();assert.equal(supplyDeletionReason(s,'flores'),null);s=run(s,'supplyDelete',{supplyId:'flores'});
 s=run(s,'supplyMove',{supplyId:'liquido-0',action:'conteo',quantity:50,responsible:'Alex'});s=run(s,'supplyStatus',{supplyId:'liquido-0',active:false});
 assert.throws(()=>run(s,'supplyDelete',{supplyId:'liquido-0'}),/existencias|movimientos/);
 assert.throws(()=>run(s,'supplyMove',{supplyId:'liquido-0',action:'conteo',percent:100,responsible:'Alex',note:'Conteo'}),/desactivado/);
 s=run(s,'supplyMove',{supplyId:'liquido-0',action:'salida',quantity:10,responsible:'Alex'});assert.equal(s.supplies!.find(i=>i.id==='liquido-0')!.stock,40);assert.deepEqual(validateBackup(s),s);
});
test('cocina y salón no pueden activar, desactivar ni eliminar productos mediante la API',()=>{
 for(const role of ['cocina','mozo'] as const){const a:Actor={id:'test',name:role,role,mustChangePassword:false};for(const type of ['productStatus','productDelete','supplyStatus','supplyDelete'])assert.throws(()=>authorizeCommand(a,{type,revision:0,productId:'p1',supplyId:'flores',active:false},seed()));}
});
test('ventas del día suman postres y bollería en una tabla, con filtros y productos históricos desactivados',()=>{
 const s=seed();s.products[0].active=false;const bakery=s.products.find(p=>p.category==='Bollería')!;
 const shifts=(['Mañana','Tarde'] as const).map(period=>({id:period,date:limaDate(),period,responsible:'Shalu',status:'closed' as const,rows:[{productId:'p1',opening:5,incoming:0,waste:0,closing:2},{productId:bakery.id,opening:4,incoming:0,waste:0,closing:2}]}));
 assert.equal(dailyProductSales(limaDate(),shifts,s.products).total,10);assert.equal(dailyProductSales(limaDate(),shifts,s.products,{},'Postres').total,6);assert.equal(dailyProductSales(limaDate(),shifts,s.products,{},'Bollería').total,4);
});
test('respaldos anteriores aceptan Viennoiserie y las alertas omiten productos desactivados',()=>{
 const s=seed();s.products[0].active=false;s.supplies![0].active=false;s.supplies![0].stock=0;
 assert(!stockAlerts(s).alerts.some(a=>a.productId==='p1'||a.productId===s.supplies![0].id));
 const old=seed() as any;old.products.find((p:any)=>p.category==='Bollería').category='Viennoiserie';assert(validateBackup(old).products.some(p=>p.category==='Bollería'));
});
test('cierre automático cero conserva la protección de versiones de borradores',async()=>{
 const client={query:async()=>({rowCount:1,rows:[{id_producto:1,cantidad:null,version:2}]})} as unknown as PoolClient;
 await assertClosingDrafts(client,'1',{'1':0},{'1':2},new Set(['1']));
 await assert.rejects(()=>assertClosingDrafts(client,'1',{'1':0},{'1':1},new Set(['1'])));
 await assert.rejects(()=>assertClosingDrafts(client,'1',{'1':0},{'1':2}));
});
