import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {seed,type State} from '../lib/inventory';
import type {Actor} from '../lib/access';
import {canViewSection,INVENTORY_SECTIONS,visibleInventory} from '../lib/inventory-visibility';
import {historyFilters} from '../lib/operation-history-store';
import {operationSummary,legacySummary} from '../lib/operation-history';
import {OperationDialog} from '../app/components/operation-dialog';
import {stockAlerts} from '../lib/stock-alerts';
import {AccountHistory} from '../app/components/account-history';
const actor=(role:Actor['role']):Actor=>({id:'00000000-0000-0000-0000-000000000001',name:role,role,mustChangePassword:false});
function fixture():State{
 const state=seed();state.products[0].reserveMinimum=20;
 state.lots=[{id:'42',productId:'p1',quantity:12,producedQuantity:12,producedAt:'2026-10-23',note:'Detalle privado de cocina',responsible:'Alex'}];
 state.shifts=[{id:'4',date:'2026-10-23',period:'Mañana',responsible:'Shalu',status:'closed',rows:[{productId:'p1',opening:1,incoming:3,closing:1,waste:0}]}];
 state.movements=[{id:'production',at:'2026-10-23T15:00:00Z',productId:'p1',quantity:12,type:'Producción',note:'Producción privada',responsible:'Alex'}];
 state.supplyMovements=[{id:'cook',supplyId:'liquido-0',action:'conteo',quantity:600,before:null,after:600,responsible:'Alex',note:'Cocina',estimated:false,at:'2026-10-23T15:00:00Z'},{id:'salon',supplyId:'liquido-0',action:'salida',quantity:10,before:600,after:590,responsible:'Shalu',note:'Salón',estimated:false,at:'2026-10-23T16:00:00Z'}];
 return state;
}
test('menús por área y administración con todas las secciones',()=>{
 assert(!canViewSection('mozo','Reserva congelada'));assert(!canViewSection('mozo','Salidas al mostrador'));assert(canViewSection('mozo','Ventas por turno'));
 assert(!canViewSection('cocina','Ventas por turno'));assert(canViewSection('cocina','Salidas al mostrador'));assert(canViewSection('cocina','Reserva congelada'));
 assert(INVENTORY_SECTIONS.every(s=>canViewSection('admin',s)));
});
test('Salón recibe disponibilidad para ingresar sin lotes, mínimos de reserva ni historial ajeno',()=>{
 const state=fixture(),before=structuredClone(state),view=visibleInventory(state,actor('mozo'),new Set(['salon']));
 assert.deepEqual(view.lots,[]);assert.deepEqual(view.movements,[]);assert.equal(view.products[0].reserveMinimum,undefined);
 assert.equal(view.replenishment?.find(p=>p.productId==='p1')?.maximum,12);assert.deepEqual(view.supplyMovements?.map(m=>m.id),['salon']);
 assert(!JSON.stringify(view).includes('Detalle privado de cocina'));assert.deepEqual(state,before);
 const html=renderToStaticMarkup(createElement(OperationDialog,{kind:'replenish',state:view,productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 assert(html.includes('Disponibles para ingresar'));assert(html.includes('max="12"'));assert(!html.includes('name="lotId"'));
 assert(!stockAlerts(view).alerts.some(a=>a.section==='Reserva congelada'));
});
test('Cocina conserva salidas pero no recibe entradas, cierres, ventas ni Excel en bruto',()=>{
 const state=fixture(),view=visibleInventory(state,actor('cocina'),new Set(['cook']));
 assert.deepEqual(view.shifts,[]);assert.deepEqual(view.excelImports,[]);assert.deepEqual(view.movements,[]);
 assert.equal(view.transferShifts?.[0].rows[0].incoming,3);assert.deepEqual(Object.keys(view.transferShifts![0].rows[0]).sort(),['incoming','productId']);
 assert.deepEqual(view.supplyMovements?.map(m=>m.id),['cook']);assert.equal(view.lots[0].quantity,12);
 assert(!JSON.stringify(view).includes('"closing"'));assert(!stockAlerts(view).alerts.some(a=>a.section==='Mostrador'));
});
test('Administración conserva el estado completo y sus movimientos antiguos',()=>{const state=fixture();assert.equal(visibleInventory(state,actor('admin')),state);});
test('historial rechaza cuenta ajena, fechas inválidas y cursores desbordados',()=>{
 assert.throws(()=>historyFilters(new URLSearchParams('account=00000000-0000-0000-0000-000000000002'),actor('mozo')));
 for(const query of ['from=2026-02-30','from=2026-10-24&to=2026-10-23','kind=Inventado','cursor=9223372036854775808'])assert.throws(()=>historyFilters(new URLSearchParams(query),actor('cocina')));
 assert.equal(historyFilters(new URLSearchParams(),actor('cocina')).account,actor('cocina').id);
});
test('auditoría resume cierre y correcciones con sus valores reales',()=>{
 const before=fixture(),after=structuredClone(before);after.shifts[0].rows[0].closing=0;
 const correction=operationSummary(before,after,{type:'correctShift',revision:0,shiftId:'4',productId:'p1',responsible:'Shalu',reason:'Conteo corregido'});
 assert.equal(correction.items[1].before,1);assert.equal(correction.items[1].after,0);assert.deepEqual(correction.responsibles,['Shalu']);
 const supply=operationSummary({...before,supplyMovements:[]},after,{type:'supplyMove',revision:0,responsible:'Alex'});
 assert.equal(supply.shift,undefined);assert.deepEqual(supply.responsibles,['Alex']);assert(supply.supplyMovementIds.includes('cook'));
});
test('historial antiguo no inventa cantidades ni atribuye cuentas por el nombre seleccionado',()=>{
 const summary=legacySummary({productId:'p1',responsable:'Alex'},fixture());assert.equal(summary.items[0].quantity,null);assert.deepEqual(summary.responsibles,['Alex']);assert.equal(summary.shift,undefined);
});
test('interfaz de historial adapta filtros y texto a Cocina y Salón',()=>{
 const render=(role:Actor['role'])=>renderToStaticMarkup(createElement(AccountHistory,{actor:actor(role),revision:1}));
 assert(render('mozo').includes('Movimientos de Salón'));assert(!render('mozo').includes('<option>Producción</option>'));
 assert(render('cocina').includes('Movimientos de Cocina'));assert(!render('cocina').includes('<option>Mostrador</option>'));
 assert(render('admin').includes('Operaciones de todas las cuentas'));
});

test('Salón conserva ventas de Excel sin recibir reservas importadas; Cocina solo ve sus ingresos',()=>{
 const state=fixture();state.excelImports=[{id:'excel-test',filename:'historico.xlsx',importedBy:'Administración',importedAt:'2026-10-22T12:00:00Z',records:[{kind:'turno',productId:'p1',date:'2026-10-22',period:'Mañana',opening:5,incoming:2,closing:1,sheet:'POSTRES',row:1},{kind:'reserva',productId:'p1',date:'2026-10-22',period:'Mañana',opening:20,produced:5,used:2,quantity:23,sheet:'RESERVA',row:1}]}];
 const salon=visibleInventory(state,actor('mozo')),kitchen=visibleInventory(state,actor('cocina'));
 assert.equal(salon.excelImports?.[0].records.length,1);assert.equal(salon.excelImports?.[0].records[0].kind,'turno');
 assert.deepEqual(kitchen.excelImports,[]);assert(kitchen.transferShifts?.some(s=>s.id.startsWith('excel:')&&s.rows[0].incoming===2));
 assert(!JSON.stringify(kitchen).includes('"closing"'));assert(!JSON.stringify(salon).includes('"produced"'));
});
