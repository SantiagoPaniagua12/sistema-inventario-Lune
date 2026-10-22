import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { lowStockPdf } from '../lib/low-stock-pdf';
import { initialSupplies } from '../lib/supplies';
import { dailyDessertSales, salesSummary } from '../lib/sales-summary';
import { execute, seed, limaDate } from '../lib/inventory';
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
