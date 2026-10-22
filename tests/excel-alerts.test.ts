import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { execute, seed, type State } from '../lib/inventory';
import { allSalesShifts, type ExcelRecord } from '../lib/excel-history';
import { validateBackup } from '../lib/backup';
import { stockAlerts } from '../lib/stock-alerts';
import { readExcel } from '../lib/excel-reader';
import { excelDate, detectColumns, matrixDrafts, previewExcel, tableDrafts, type ExcelSheet } from '../lib/excel-preview';
import { dailyDessertSales } from '../lib/sales-summary';

const turn:ExcelRecord={kind:'turno',productId:'p1',date:'2025-10-15',period:'Mañana',opening:6,incoming:4,closing:3,sheet:'POSTRES OCTUBRE',row:3};
const reserve:ExcelRecord={kind:'reserva',productId:'p1',date:'2025-10-15',period:'Tarde',opening:10,produced:5,used:3,quantity:12,sheet:'Reserva',row:3};
function archive(s:State,records:ExcelRecord[]=[turn,reserve]){return execute(s,{type:'excelImport',revision:s.revision,filename:'lune.xlsx',importedBy:'Administración',records});}

test('las alertas incluyen todas las áreas, mínimos inclusivos y distinguen saldos desconocidos',()=>{
  let s=seed();
  assert.equal(stockAlerts(s).alerts.length,0);
  s=execute(s,{type:'product',revision:s.revision,productId:'p1',name:s.products[0].name,minimum:1,reserveMinimum:5});
  s=execute(s,{type:'produce',revision:s.revision,productId:'p1',quantity:5,date:'2025-10-15',responsible:'Cocina'});
  s=execute(s,{type:'open',revision:s.revision,date:'2025-10-15',period:'Mañana',responsible:'Mostrador',openings:{p1:1}});
  s.supplies=[...s.supplies!,{id:'clean',name:'Detergente',group:'Limpieza',unit:'botella',minimum:2,stock:1,capacityMl:null,packSize:1,note:'',estimated:false}];
  for(const id of ['fruta-0','agua-con-gas','cajas-pequenas','liquido-0']){
    const item=s.supplies.find(item=>item.id===id)!;item.stock=0;
  }
  const summary=stockAlerts(s);
  assert(summary.alerts.some(a=>a.section==='Mostrador'&&a.productId==='p1'&&a.stock===1&&a.estimated));
  assert(summary.alerts.some(a=>a.section==='Reserva congelada'&&a.stock===5));
  for(const section of ['Limpieza','Frutas congeladas','Bebidas','Empaques','Preparados líquidos'])assert(summary.alerts.some(a=>a.section===section));
  assert(!summary.alerts.some(a=>a.id==='supply:leche-entera'));
  assert(summary.missingCounts>0);
  const imported=archive(seed());
  assert.equal(stockAlerts(imported).alerts.length,0,'El histórico no debe provocar alertas de stock actual');
});

test('importar conserva inventario y guarda procedencia; el histórico alimenta ventas sin contar moldes usados',()=>{
  const s=seed();
  const after=archive(s,[turn,{...turn,period:'Tarde',opening:3,incoming:0,closing:1},reserve]);
  assert.deepEqual(after.shifts,s.shifts);assert.deepEqual(after.lots,s.lots);assert.deepEqual(after.movements,s.movements);
  assert.equal(after.excelImports![0].importedBy,'Administración');
  assert.deepEqual(validateBackup(after),after);
  const sales=dailyDessertSales('2025-10-15',allSalesShifts(after),after.products);
  assert.equal(sales.total,9);assert.equal(sales.complete,false,'Un archivo parcial no representa el conteo de todos los postres');
  assert.equal(allSalesShifts(after).length,2);
});

test('se rechazan duplicados, productos no postres, fechas futuras y fórmulas inconsistentes sin reemplazar datos',()=>{
  const s=archive(seed());
  assert.throws(()=>archive(s),/ya existe/);
  assert.throws(()=>archive(seed(),[turn,turn]),/repetido/);
  assert.throws(()=>archive(seed(),[{...turn,productId:'v1'}]),/solo puede asociarse/);
  assert.throws(()=>archive(seed(),[{...turn,date:'2099-01-01'}]),/futuras/);
  assert.throws(()=>archive(seed(),[{...turn,closing:99}]),/cierre supera/);
  assert.throws(()=>archive(seed(),[{...reserve,quantity:88}]),/saldo de reserva/);
  assert.throws(()=>execute(s,{type:'excelImport',revision:s.revision-1,filename:'lune.xlsx',importedBy:'Admin',records:[turn]}),/datos cambiaron/);
  assert.throws(()=>execute(s,{type:'open',revision:s.revision,date:turn.date,period:turn.period,responsible:'Mostrador'}),/histórico de Excel/);
  const operational=execute(seed(),{type:'open',revision:0,date:turn.date,period:turn.period,responsible:'Mostrador'});
  assert.throws(()=>archive(operational,[turn]),/ya existe/);
  const forged=structuredClone(s);forged.excelImports![0].records.push({...turn});
  assert.throws(()=>validateBackup(forged),/repetido/);
});

test('lector .xlsx real: celdas combinadas, fechas horizontales, fórmulas y turnos de la foto',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('POSTRES OCTUBRE');
  sheet.getCell('A1').value='POSTRES TURNO MAÑANA';
  sheet.mergeCells('B1:C1');sheet.getCell('B1').value='miércoles, 15 de Octubre de 2025';
  sheet.mergeCells('D1:E1');sheet.getCell('D1').value=new Date('2025-10-16T00:00:00Z');sheet.getCell('D1').numFmt='dd/mm/yyyy';
  sheet.mergeCells('A2:A5');sheet.getCell('A2').value='SACHER DE TUMBO';
  for(const [i,label] of ['Entrada','Ingreso nuevo','Salida turno','Ventas'].entries()){
    sheet.getCell(i+2,2).value=label;sheet.getCell(i+2,4).value=label;
  }
  [6,4,3].forEach((n,i)=>sheet.getCell(i+2,3).value=n);
  [3,2,1].forEach((n,i)=>sheet.getCell(i+2,5).value=n);
  sheet.getCell('C5').value={formula:'C2+C3-C4',result:7};sheet.getCell('E5').value={formula:'E2+E3-E4',result:4};
  sheet.getCell('A6').value='POSTRES TURNO TARDE';sheet.mergeCells('B6:C6');sheet.getCell('B6').value='15/10/2025';
  sheet.mergeCells('A7:A10');sheet.getCell('A7').value='SACHER DE TUMBO';
  ['Entrada','Ingreso nuevo','Salida turno','Ventas'].forEach((label,i)=>{sheet.getCell(i+7,2).value=label;sheet.getCell(i+7,3).value=[3,0,1,2][i];});
  const bytes=await book.xlsx.writeBuffer();
  const [grid]=await readExcel(Buffer.from(bytes));
  const drafts=matrixDrafts(grid,'turno');
  const result=previewExcel(drafts,seed(),'turno',{products:{},date:'',period:'',date1904:false});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.records.length,3);
  assert.deepEqual(result.records.map(row=>[row.date,row.period]),[['2025-10-15','Mañana'],['2025-10-16','Mañana'],['2025-10-15','Tarde']]);
  const noResult=new ExcelJS.Workbook();const bad=noResult.addWorksheet('Fórmula');bad.getCell('A1').value={formula:'1+1'};
  const [badSheet]=await readExcel(Buffer.from(await noResult.xlsx.writeBuffer()));
  assert.equal(badSheet.rows[0][0],'#FORMULA_SIN_RESULTADO');
  await assert.rejects(()=>readExcel(Buffer.from('no es excel')),/no es un Excel/);
});

test('tablas y reserva por turnos: valores vacíos no son cero, asociación manual y omisión explícita',()=>{
  const sheet:ExcelSheet={name:'Reserva',date1904:false,rows:[['Producto','Fecha','Turno','Entrada','Producción','Usados','Saldo'],['Sacher de Tumbo','15/10/2025','Tarde',10,5,3,12]]};
  const columns=detectColumns(sheet.rows[0]);
  const options={products:{},date:'',period:'',date1904:false};
  const good=previewExcel(tableDrafts(sheet,0,columns),seed(),'reserva',options);
  assert.deepEqual(good.errors,[]);assert.equal(good.records.length,1);
  const bad=structuredClone(sheet);bad.rows[1][4]=null;
  assert(previewExcel(tableDrafts(bad,0,columns),seed(),'reserva',options).errors[0].includes('vacío'));
  const unknown=structuredClone(sheet);unknown.rows[1][0]='Sacher abreviado';
  const drafts=tableDrafts(unknown,0,columns);
  assert.equal(previewExcel(drafts,seed(),'reserva',options).records.length,0);
  assert.equal(previewExcel(drafts,seed(),'reserva',{...options,products:{'Sacher abreviado':'p1'}}).records.length,1);
  assert.equal(previewExcel(drafts,seed(),'reserva',{...options,products:{'Sacher abreviado':'__skip'}}).omitted,1);
  assert.equal(excelDate('jueves, 15 de octubre de 2026'),'2026-10-15');
  assert.throws(()=>excelDate('31/02/2025'),/inválida/);
});

test('fechas futuras y bloques repetidos de la matriz nunca heredan una fecha anterior válida',()=>{
  const sheet:ExcelSheet={name:'POSTRES MAÑANA',date1904:false,rows:[
    [null,'15/10/2025','15/10/2025'],['Sacher de Tumbo','Entrada',2],[null,'Ingreso nuevo',0],[null,'Salida turno',1],[null,'Ventas',1],
    [null,'15/10/2099','15/10/2099'],['Sacher de Tumbo','Entrada',3],[null,'Ingreso nuevo',0],[null,'Salida turno',1],[null,'Ventas',2],
  ]};
  const result=previewExcel(matrixDrafts(sheet,'turno'),seed(),'turno',{products:{},date:'',period:'',date1904:false});
  assert.equal(result.records.length,1);assert(result.errors.some(error=>error.includes('futura')));
  const duplicate=structuredClone(sheet);duplicate.rows[6]=[null,'15/10/2025','15/10/2025'];
  const repeated=previewExcel(matrixDrafts(duplicate,'turno'),seed(),'turno',{products:{},date:'',period:'',date1904:false});
  assert(repeated.errors.some(error=>error.includes('repite')));
});
