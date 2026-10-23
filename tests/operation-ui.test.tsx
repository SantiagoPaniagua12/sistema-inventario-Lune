import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OperationDialog,type OperationKind} from '../app/components/operation-dialog';
import {seed,limaDate,type State} from '../lib/inventory';
import {CloseShiftDialog,closingFingerprint} from '../app/components/close-shift-dialog';

const render=(kind:OperationKind,state:State=seed())=>renderToStaticMarkup(createElement(OperationDialog,{kind,state,productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));

test('ingreso múltiple muestra todo el catálogo sin pedir lote ni nombre de mozo',()=>{
  const html=render('replenish');
  assert.equal((html.match(/data-product=/g)??[]).length,21);
  assert(!html.includes('name="lotId"'));
  assert(!html.includes('name="responsible"'));
  assert(html.includes('Guardar ingresos'));
  assert(html.includes('Croissant de almendras'));
});

test('producción múltiple pide un solo cocinero y una fecha para todo el catálogo',()=>{
  const html=render('produce');
  assert.equal((html.match(/data-product=/g)??[]).length,21);
  assert.equal((html.match(/name="responsible"/g)??[]).length,1);
  assert.equal((html.match(/name="date"/g)??[]).length,1);
});

test('apertura muestra un mozo por mañana y dos campos obligatorios para la tarde',()=>{
  assert.equal((render('open').match(/aria-label="Mozo /g)??[]).length,1);
  const state=seed();
  state.shifts=[{id:'morning',date:limaDate(),period:'Mañana',responsible:'Shalu',responsibles:['Shalu'],status:'closed',rows:[]}];
  const html=render('open',state);
  assert.equal((html.match(/aria-label="Mozo /g)??[]).length,2);
  assert(html.includes('La tarde requiere al menos dos mozos'));
});

test('un envío pendiente bloquea todos los campos del formulario',()=>{
  const html=renderToStaticMarkup(createElement(OperationDialog,{kind:'produce',state:seed(),productId:'p1',busy:true,serverError:'',onSave:async()=>true,onClose:()=>{}}));
  assert(html.includes('<fieldset class="operation-fields" disabled="">'));
  assert(html.includes('Guardando…'));
});

test('la confirmación de cierre muestra el equipo y el conteo sin usar un diálogo nativo',()=>{
  const state=seed();
  const shift={id:'m',date:limaDate(),period:'Mañana' as const,status:'open' as const,responsible:'Shalu',responsibles:['Shalu','Karla'],rows:[{productId:'p1',opening:5,incoming:3,waste:0,closing:null}]};
  const html=renderToStaticMarkup(createElement(CloseShiftDialog,{shift,products:state.products,counts:{p1:'2'},busy:false,error:'',onCancel:()=>{},onConfirm:()=>{}}));
  assert(html.includes('Confirmar cierre de turno'));
  assert(html.includes('Shalu, Karla'));
  assert(html.includes('Sacher de Tumbo'));
  assert(html.includes('Volver al conteo'));
  assert.notEqual(closingFingerprint(shift,{p1:'2'}),closingFingerprint(shift,{p1:'3'}));
});
