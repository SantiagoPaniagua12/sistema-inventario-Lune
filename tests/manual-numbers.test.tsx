import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {manualNumberMessage,normalizeManualNumber} from '../lib/manual-number';
import {salonSupplies,supplyNameKey} from '../lib/salon-supplies';
import {ManualCountInput} from '../app/components/manual-count-input';
import {OperationDialog} from '../app/components/operation-dialog';
import {seed,execute,limaDate} from '../lib/inventory';
import {validateBackup} from '../lib/backup';
import {authorizeCommand,type Actor} from '../lib/access';

test('edición manual permite borrar y cero, rechaza fracciones, signos y notación exponencial en cantidades',()=>{
 for(const value of ['','0','25','1000000000'])assert.equal(normalizeManualNumber(value),value);
 for(const value of ['-1','+1','2.5','2,5','1e3','texto'])assert.equal(normalizeManualNumber(value),null);
 assert.equal(manualNumberMessage('0',{min:0,max:10}), '');assert(manualNumberMessage('0',{min:1,max:10}));assert(manualNumberMessage('11',{min:0,max:10}));
 assert.equal(manualNumberMessage('',{min:1}), '');assert.equal(manualNumberMessage('1000000000',{max:1000000000}), '');assert(manualNumberMessage('1000000001',{max:1000000000}));
});
test('porcentajes conservan un decimal, aceptan coma y mantienen los límites 0–100',()=>{
 assert.equal(normalizeManualNumber('12,5',1),'12.5');assert.equal(normalizeManualNumber('12.55',1),null);assert.equal(normalizeManualNumber('1e2',1),null);
 assert.equal(manualNumberMessage('0',{min:0,max:100,step:'.1',decimalPlaces:1}),'');assert.equal(manualNumberMessage('12.5',{min:0,max:100,step:'.1',decimalPlaces:1}),'');assert(manualNumberMessage('100.1',{max:100,decimalPlaces:1}));assert(manualNumberMessage('.', {decimalPlaces:1}));
});
test('campos de insumos soportan el máximo real y todas las cantidades de producción son texto numérico',()=>{
 const large=renderToStaticMarkup(createElement(ManualCountInput,{max:1000000000,min:0,step:1,value:'1000000000'}));assert(large.includes('value="1000000000"'));assert(large.includes('type="text"'));
 const s=seed();const props={state:s,productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}};
 for(const kind of ['produce','open','replenish'] as const){const html=renderToStaticMarkup(createElement(OperationDialog,{...props,kind}));assert(!html.includes('type="number"'));assert(html.includes('inputMode="numeric"'));}
});
test('los doce insumos tienen clasificación, unidades y existencias pendientes de conteo',()=>{
 const items=salonSupplies();assert.equal(items.length,12);assert.equal(items.filter(i=>i.group==='Empaques').length,8);assert.equal(items.filter(i=>i.group==='Papelería').length,4);assert.equal(items.filter(i=>i.unit==='rollo').length,2);assert(items.every(i=>i.stock===null&&i.minimum===null&&i.packSize===1));
 assert.equal(new Set(items.map(i=>supplyNameKey(i.name))).size,12);assert.equal(supplyNameKey(' BOLSAS DE PAPEL PEQUEÑAS '),supplyNameKey('Bolsas de papel pequeñas'));
});
test('papelería cuenta rollos y unidades, conserva historial y participa en respaldos',()=>{
 let s=seed();s=execute(s,{type:'supplyMove',revision:s.revision,supplyId:'papeleria-boletas',action:'conteo',quantity:10,responsible:'Shalu'});s=execute(s,{type:'supplyMove',revision:s.revision,supplyId:'papeleria-boletas',action:'salida',quantity:2,responsible:'Shalu'});assert.equal(s.supplies!.find(i=>i.id==='papeleria-boletas')!.stock,8);assert.deepEqual(validateBackup(s),s);
 const kitchen:Actor={id:'cocina',name:'Cocina',role:'cocina',mustChangePassword:false};assert.throws(()=>authorizeCommand(kitchen,{type:'supplyMove',revision:s.revision,supplyId:'papeleria-boletas',action:'salida',quantity:1,responsible:'Alex'},s));
 const salon:Actor={id:'salon',name:'Salón',role:'mozo',mustChangePassword:false};assert.equal(authorizeCommand(salon,{type:'supplyMove',revision:s.revision,supplyId:'papeleria-boletas',action:'salida',quantity:1,responsible:'Shalu'},s).responsible,'Shalu');
});


test('fracciones de bolsa aceptan punto o coma, dos decimales y retiros menores de una bolsa',()=>{
 for(const [typed,normalized] of [['0,50','0.50'],['0.25','0.25'],['0.01','0.01']])assert.equal(normalizeManualNumber(typed,2),normalized);
 assert.equal(normalizeManualNumber('0.001',2),null);
 const rules={min:0.01,max:1000000000,step:'0.01',decimalPlaces:2};
 for(const value of ['0.01','0.29','0.50','999999999.99','1000000000'])assert.equal(manualNumberMessage(value,rules),'');
 assert(manualNumberMessage('0',rules));assert(manualNumberMessage('0.001',rules));assert(manualNumberMessage('1000000000.01',rules));
 const html=renderToStaticMarkup(createElement(ManualCountInput,{...rules,value:'0.50'}));
 assert(html.includes('inputMode="decimal"'));assert(html.includes('step="0.01"'));assert(html.includes('value="0.50"'));
});
