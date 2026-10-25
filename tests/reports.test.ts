import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { lowStockPdf } from '../lib/low-stock-pdf';
import { initialSupplies } from '../lib/supplies';
import { dailyDessertSales, salesSummary } from '../lib/sales-summary';
import { execute, seed, limaDate, type Shift } from '../lib/inventory';
import {displayTransfers} from '../lib/display-transfers';
import {allSalesShifts} from '../lib/excel-history';

test('salidas al mostrador separan fecha, turnos y productos sin sumar entradas ni ventas',()=>{
  const s=seed();
  const morning:Shift={id:'m',date:'2026-10-22',period:'Mañana',status:'closed',responsible:'Shalu',rows:[{productId:'p1',opening:100,incoming:3,waste:0,closing:98},{productId:'p2',opening:0,incoming:1,waste:0,closing:0},{productId:'v1',opening:10,incoming:4,waste:0,closing:5}]};
  const afternoon:Shift={...morning,id:'t',period:'Tarde',status:'open',rows:[{productId:'p1',opening:98,incoming:2,waste:0,closing:null}]};
  const shifts=[morning,afternoon,{...morning,id:'old',date:'2026-10-21'}];
  const report=displayTransfers('2026-10-22',shifts,s.products);
  assert.equal(report.morning,4);assert.equal(report.afternoon,2);assert.equal(report.total,6);
  assert.deepEqual(report.items.map(i=>[i.id,i.morning,i.afternoon,i.total]),[['p1',3,2,5],['p2',1,null,1]]);
  assert.equal(displayTransfers('2026-10-22',shifts,s.products,'Bollería').total,4);
  assert.equal(displayTransfers('2026-10-22',shifts,s.products,'Todos').total,10);
  const missing=displayTransfers('2026-10-20',shifts,s.products);
  assert.equal(missing.total,0);assert(missing.periods.every(p=>!p.shift));
  assert.equal(displayTransfers('2026-10-22',[morning],s.products).periods[1].shift,undefined);
});

test('salidas reflejan correcciones y distinguen un ingreso cero de una fila histórica ausente',()=>{
  let s=seed();
  const run=(type:string,data:Record<string,unknown>)=>{s=execute(s,{type,revision:s.revision,...data});};
  run('open',{date:limaDate(),period:'Mañana',responsible:'Shalu'});
  run('produce',{productId:'p1',quantity:10,date:limaDate(),responsible:'Joel'});
  const lotId=s.lots[0].id;
  run('replenish',{productId:'p1',lotId,quantity:5});
  run('replenish',{productId:'p1',lotId,quantity:2});
  assert.equal(displayTransfers(limaDate(),s.shifts,s.products).total,7);
  run('correctShift',{shiftId:s.shifts[0].id,productId:'p1',lotId,incoming:4,responsible:'Karla',reason:'Digitación'});
  assert.equal(displayTransfers(limaDate(),s.shifts,s.products).total,4);
  s.excelImports=[{id:'archive',filename:'postres.xlsx',importedBy:'Admin',importedAt:'2026-10-21T20:00:00Z',records:[{kind:'turno',productId:'p1',date:'2026-10-21',period:'Mañana',opening:10,incoming:2,closing:5,sheet:'Octubre',row:1},{kind:'turno',productId:'p1',date:'2026-10-21',period:'Tarde',opening:5,incoming:0,closing:1,sheet:'Octubre',row:2}]}];
  const archive=displayTransfers('2026-10-21',allSalesShifts(s),s.products);
  assert.equal(archive.total,2);assert.equal(archive.items[0].afternoon,0);
  assert(archive.periods.every(p=>p.shift?.id.startsWith('excel:')));
});
test('ventas provisionales solo suman productos con conteos válidos',()=>{
  let s=seed();s=execute(s,{type:'open',revision:s.revision,date:limaDate(),period:'Mañana',responsible:'Mostrador',openings:{p1:5,p2:8,p3:4}});
  const summary=salesSummary(s.shifts[0],s.products,{p1:'2',p2:'',p3:'9',p4:'0'});
  assert.equal(summary.total,3);assert.equal(summary.counted,2);assert.equal(summary.pending,19);
  assert.deepEqual(summary.items.map(i=>i.id),['p1']);
});
test('el cierre conserva el detalle y ranking de productos vendidos',()=>{
  let s=seed();s=execute(s,{type:'open',revision:s.revision,date:limaDate(),period:'Mañana',responsible:'Mostrador',openings:{p1:5,p2:8}});
  s=execute(s,{type:'close',revision:s.revision,counts:Object.fromEntries(s.products.map(p=>[p.id,p.id==='p1'?2:0]))});
  const summary=salesSummary(s.shifts[0],s.products);
  assert.equal(summary.total,11);assert.equal(summary.complete,true);
  assert.deepEqual(summary.items.map(i=>i.quantity),[8,3]);
});
test('el PDF genera páginas válidas y pagina nombres largos sin perder filas',async()=>{
  const items=Array.from({length:80},(_,i)=>({...initialSupplies()[0],id:`pdf-${i}`,name:`Fruta de prueba ${i} con un nombre largo para verificar el ajuste del texto`,stock:i%2,minimum:5}));
  const bytes=await lowStockPdf(items,{at:new Date('2026-10-21T12:00:00Z')});
  const doc=await PDFDocument.load(bytes);
  assert(doc.getPageCount()>=3);
  assert.equal(doc.getTitle(),'Lune - Insumos para reposición');
  const empty=await PDFDocument.load(await lowStockPdf(initialSupplies()));
  assert.equal(empty.getPageCount(),1);
});

test('el dashboard diario suma mañana y tarde por postre sin mezclar fechas ni viennoiserie',()=>{
  let s=seed();
  const date=limaDate();
  s=execute(s,{type:'open',revision:s.revision,date,period:'Mañana',responsible:'Mostrador',openings:{p1:5,p2:4,v1:6}});
  s=execute(s,{type:'close',revision:s.revision,counts:Object.fromEntries(s.products.map(p=>[p.id,p.id==='p1'?2:p.id==='p2'?4:p.id==='v1'?1:0]))});
  s=execute(s,{type:'open',revision:s.revision,date,period:'Tarde',responsible:'Mostrador'});
  s=execute(s,{type:'close',revision:s.revision,counts:Object.fromEntries(s.products.map(p=>[p.id,p.id==='p1'||p.id==='p2'?1:0]))});
  const otherDay={...s.shifts[0],id:'other-day',date:'2000-01-01'};
  const summary=dailyDessertSales(date,[otherDay,...s.shifts],s.products,{p1:'999'});
  assert.equal(summary.total,7);
  assert.equal(summary.complete,true);
  assert.deepEqual(summary.periods.map(p=>p.summary.total),[3,4]);
  assert.deepEqual(summary.items.map(({id,morning,afternoon,total})=>({id,morning,afternoon,total})),[
    {id:'p1',morning:3,afternoon:1,total:4},
    {id:'p2',morning:0,afternoon:3,total:3},
  ]);
});

test('el dashboard diario distingue turnos faltantes y conteos pendientes de ventas cero',()=>{
  let s=seed();
  const date=limaDate();
  s=execute(s,{type:'open',revision:s.revision,date,period:'Mañana',responsible:'Mostrador',openings:{p1:5,p2:3}});
  const summary=dailyDessertSales(date,s.shifts,s.products,{p1:'2',p2:'9'});
  assert.equal(summary.total,3);
  assert.equal(summary.complete,false);
  assert.equal(summary.counted,1);
  assert.equal(summary.periods[1].shift,undefined);
  assert.equal(summary.items[0].afternoon,null);
  assert.equal(dailyDessertSales('2000-01-01',s.shifts,s.products).counted,0);
});
