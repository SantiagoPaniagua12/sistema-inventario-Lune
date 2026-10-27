import {test} from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {seed,execute,limaDate,shiftTeam,type State} from '../lib/inventory';import {authorizeCommand,type Actor} from '../lib/access';import {operationSummary} from '../lib/operation-history';import {validateBackup} from '../lib/backup';import {OperationDialog} from '../app/components/operation-dialog';import {CloseShiftDialog} from '../app/components/close-shift-dialog';
const run=(s:State,type:string,data:Record<string,unknown>)=>execute(s,{type,revision:s.revision,...data});
const open=(team=['Shalu','Nicol'],period:'Mañana'|'Tarde'='Mañana')=>run(seed(),'open',{date:limaDate(),period,responsibles:team,openings:{p1:5}});
const change=(s:State,data:Record<string,unknown>={})=>({type:'replaceWaiter',revision:s.revision,shiftId:s.shifts.at(-1)!.id,outgoing:'Nicol',replacement:'Santiago',reason:'No asistió',operationId:crypto.randomUUID(),...data});
test('reemplazo conserva posiciones, cantidades e historial; el cierre toma el equipo actualizado',()=>{
 const before=open(),command=change(before),after=execute(before,command);assert.deepEqual(shiftTeam(after.shifts[0]),['Shalu','Santiago']);assert.deepEqual(after.shifts[0].rows,before.shifts[0].rows);assert.deepEqual(after.movements,before.movements);assert.deepEqual(after.lots,before.lots);assert.deepEqual(after.supplies,before.supplies);assert.equal(after.revision,before.revision+1);assert.deepEqual(validateBackup(after),after);
 const summary=operationSummary(before,after,command);assert(summary.note.includes('Nicol → Santiago'));assert(summary.note.includes('No asistió'));assert.deepEqual(summary.responsibles,['Shalu','Santiago']);
 const counts=Object.fromEntries(after.shifts[0].rows.map(row=>[row.productId,String(row.opening)]));const html=renderToStaticMarkup(createElement(CloseShiftDialog,{shift:after.shifts[0],products:after.products,counts,busy:false,error:'',onCancel:()=>{},onConfirm:()=>{}}));assert(html.includes('Shalu, Santiago'));assert(!html.includes('Nicol'));
});
test('se puede reemplazar al responsable principal con uno o cuatro mozos',()=>{
 for(const [team,period] of [[['Shalu'],'Mañana'],[['Shalu','Karla','Nicol','Emilia'],'Tarde']] as const){const before=open([...team],period),after=execute(before,change(before,{outgoing:'Shalu'}));assert.equal(after.shifts[0].responsible,'Santiago');assert.deepEqual(shiftTeam(after.shifts[0]),team.map(name=>name==='Shalu'?'Santiago':name));assert.deepEqual(validateBackup(after),after);}
});
test('rechaza cerrado, turno distinto, duplicados, nombres inválidos y motivo vacío sin modificar datos',()=>{
 const s=open(),unchanged=structuredClone(s);for(const values of [{shiftId:'otro'},{outgoing:'Diogo'},{replacement:'Shalu'},{replacement:'Nicol'},{replacement:'Alex'},{reason:' '},{reason:'x'.repeat(181)}])assert.throws(()=>execute(s,change(s,values)));
 const closed=run(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(row=>[row.productId,row.opening]))});assert.throws(()=>execute(closed,change(closed)),/turno abierto/);assert.deepEqual(s,unchanged);
 const legacy=open();legacy.shifts[0].period='Tarde';legacy.shifts[0].responsibles=['Shalu'];assert.throws(()=>execute(legacy,change(legacy,{outgoing:'Shalu'})),/2 y 4/);
});
test('solo Salón y Administración autorizan reemplazos; no acepta cambiar un turno cerrado ni equipos falsificados',()=>{
 const state=open();for(const role of ['admin','mozo'] as const){const actor:Actor={id:role,name:role,role,mustChangePassword:false};const command=authorizeCommand(actor,change(state,{responsibles:['Alex']}),state);assert.equal(command.responsibles,undefined);assert.deepEqual(shiftTeam(execute(state,command).shifts[0]),['Shalu','Santiago']);assert.throws(()=>authorizeCommand(actor,change(state,{operationId:undefined}),state));assert.throws(()=>authorizeCommand(actor,change(state,{shiftId:'cerrado'}),state));}
 const actor:Actor={id:'cocina',name:'Cocina',role:'cocina',mustChangePassword:false};assert.throws(()=>authorizeCommand(actor,change(state),state));
});
test('formulario pide reemplazo y motivo; evita ofrecer a quienes ya están en el equipo',()=>{
 const html=renderToStaticMarkup(createElement(OperationDialog,{kind:'replaceWaiter',state:open(),productId:'p1',busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));assert(html.includes('Cambiar mozo'));assert(/<input(?=[^>]*name="reason")(?=[^>]*required="")[^>]*>/.test(html));const options=html.split('name="replacement"')[1].split('</select>')[0];assert(options.includes('Santiago'));assert(!options.includes('Shalu'));assert(!options.includes('Nicol'));assert(html.includes('Guardar cambio'));
});
