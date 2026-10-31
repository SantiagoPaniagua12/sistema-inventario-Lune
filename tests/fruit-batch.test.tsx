import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execute,seed,limaDate,type State,type Command} from '../lib/inventory';
import {authorizeCommand,type Actor} from '../lib/access';
import {fruitWithdrawals} from '../lib/fruit-withdrawals';
import {operationSummary,ACTIONS} from '../lib/operation-history';
import {validateBackup} from '../lib/backup';
import {FruitBatchWithdrawalDialog} from '../app/components/fruit-batch-dialog';
import {FruitWorkspace} from '../app/components/fruit-workspace';
const salon:Actor={id:'salon',name:'Salón',role:'mozo',mustChangePassword:false};
const raw=(s:State,type:string,fields:Record<string,unknown>={})=>execute(s,{type,revision:s.revision,...fields});
function fixture(){let s=seed();for(const supplyId of ['fruta-0','fruta-1','fruta-2'])s=raw(s,'supplyMove',{supplyId,action:'conteo',quantity:10,responsible:'Joel'});return raw(s,'open',{date:limaDate(),period:'Mañana',responsibles:['Shalu','Karla']});}
const stock=(s:State,id='fruta-0')=>s.supplies!.find(f=>f.id===id)!.stock;
const command=(s:State,items:unknown):Command=>({type:'supplyFruitWithdrawalBatch',revision:s.revision,operationId:crypto.randomUUID(),shiftId:s.shifts[0].id,responsible:'Shalu',items});
const batch=(s:State,items:unknown)=>{const c=command(s,items);return execute(s,authorizeCommand(salon,c,s));};

test('varias frutas se descuentan juntas con un responsable, una revisión y retiros independientes',()=>{
 const original=fixture(),snapshot=structuredClone(original),s=batch(original,[{supplyId:'fruta-0',quantity:2},{supplyId:'fruta-1',quantity:1}]);
 assert.equal(stock(s),8);assert.equal(stock(s,'fruta-1'),9);assert.equal(s.revision,original.revision+1);
 const roots=fruitWithdrawals(s);assert.equal(roots.length,2);assert.equal(new Set(roots.map(w=>w.id)).size,2);assert(roots.every(w=>w.responsible==='Shalu'&&w.shiftId===s.shifts[0].id));
 assert.deepEqual(s.shifts,original.shifts);assert.deepEqual(s.movements,original.movements);assert.deepEqual(s.lots,original.lots);assert.deepEqual(original,snapshot);assert.deepEqual(validateBackup(s),s);
});
test('cantidades o frutas inválidas y repetidas rechazan el envío entero sin descuentos parciales',()=>{
 const s=fixture(),snapshot=structuredClone(s);
 for(const quantity of [0,-1,0.5,11,NaN,Infinity,null,'2',1_000_000_001])assert.throws(()=>batch(s,[{supplyId:'fruta-0',quantity:1},{supplyId:'fruta-1',quantity}]));
 for(const items of [[],null,[null],[{}],[{supplyId:'missing',quantity:1}],[{supplyId:'insumo-0',quantity:1}],[{supplyId:'fruta-0',quantity:1},{supplyId:'fruta-0',quantity:2}]])assert.throws(()=>batch(s,items));
 assert.throws(()=>batch(s,[{supplyId:'fruta-0',quantity:1},{supplyId:'fruta-3',quantity:1}]),/conteo/);
 const inactive=structuredClone(s);inactive.supplies!.find(f=>f.id==='fruta-1')!.active=false;assert.throws(()=>batch(inactive,[{supplyId:'fruta-0',quantity:1},{supplyId:'fruta-1',quantity:1}]),/desactivada/);
 assert.deepEqual(s,snapshot);
});
test('se acumulan retiros posteriores y cada fruta puede corregirse o anularse por separado',()=>{
 let s=batch(fixture(),[{supplyId:'fruta-2',quantity:1},{supplyId:'fruta-1',quantity:2}]);
 s=batch(s,[{supplyId:'fruta-2',quantity:1}]);assert.equal(stock(s,'fruta-2'),8);assert.equal(fruitWithdrawals(s).filter(w=>w.supplyId==='fruta-2').reduce((n,w)=>n+w.quantity,0),2);
 const root=fruitWithdrawals(s).find(w=>w.supplyId==='fruta-1')!;
 s=raw(s,'supplyFruitWithdrawalCorrection',{shiftId:root.shiftId,withdrawalId:root.id,withdrawalVersion:root.logs[0].id,supplyId:'fruta-1',quantity:3,responsible:'Karla',reason:'Faltaba una porción'});
 assert.equal(stock(s,'fruta-1'),7);assert.equal(stock(s,'fruta-2'),8);
 const current=fruitWithdrawals(s).find(w=>w.id===root.id)!;
 s=raw(s,'supplyFruitWithdrawalCorrection',{shiftId:root.shiftId,withdrawalId:root.id,withdrawalVersion:current.logs[0].id,supplyId:'fruta-1',cancel:true,responsible:'Karla',reason:'Duplicado'});
 assert.equal(stock(s,'fruta-1'),10);assert.equal(stock(s,'fruta-2'),8);assert.equal(fruitWithdrawals(s).find(w=>w.id===root.id)!.quantity,0);assert.deepEqual(validateBackup(s),s);
});
test('una auditoría del envío incluye todas las frutas y todos los movimientos',()=>{
 const before=batch(fixture(),[{supplyId:'fruta-0',quantity:1}]);
 const c=command(before,[{supplyId:'fruta-1',quantity:2},{supplyId:'fruta-2',quantity:3}]),after=execute(before,authorizeCommand(salon,c,before));
 const summary=operationSummary(before,after,c);assert.equal(summary.items.length,2);assert.deepEqual(summary.items.map(i=>i.quantity).sort(),[2,3]);assert(summary.items.every(i=>i.before===0&&i.after===i.quantity));assert.equal(summary.supplyMovementIds.length,2);assert.equal(summary.shift!.id,before.shifts[0].id);assert.deepEqual(summary.responsibles,['Shalu']);assert.equal(ACTIONS.supplyFruitWithdrawalBatch.kind,'Insumos');
});
test('permisos, turno abierto, responsable e identificador se validan también para el envío múltiple',()=>{
 const s=fixture(),c=command(s,[{supplyId:'fruta-0',quantity:1}]);
 for(const role of ['mozo','admin'] as const)assert.equal(authorizeCommand({...salon,role},c,s).responsible,'Shalu');
 assert.throws(()=>authorizeCommand({...salon,role:'cocina'},c,s),/permiso/);
 assert.throws(()=>authorizeCommand(salon,{...c,responsible:'Santiago'},s),/equipo/);
 assert.throws(()=>authorizeCommand(salon,{...c,operationId:undefined},s));
 assert.throws(()=>authorizeCommand(salon,{...c,shiftId:'missing'},s));
 assert.throws(()=>batch({...s,revision:s.revision+1},[]));
 assert.throws(()=>execute(s,{...c,revision:s.revision-1}),/datos cambiaron/);
 const closed=raw(s,'close',{counts:Object.fromEntries(s.shifts[0].rows.map(r=>[r.productId,0]))});
 assert.throws(()=>authorizeCommand({...salon,role:'admin'},{...c,revision:closed.revision,allowClosed:true},closed),/cerrados/);
});
test('el formulario único lista todas las frutas, un solo mozo y campos vacíos sin requerir cada cantidad',()=>{
 const state=fixture();state.supplies!.find(f=>f.id==='fruta-0')!.stock=0;state.supplies!.find(f=>f.id==='fruta-1')!.active=false;
 const html=renderToStaticMarkup(createElement(FruitBatchWithdrawalDialog,{state,shiftId:state.shifts[0].id,busy:false,serverError:'',onSave:async()=>true,onClose:()=>{}}));
 assert.equal((html.match(/data-fruit=/g)??[]).length,6);assert.equal((html.match(/name="responsible"/g)??[]).length,1);assert.equal((html.match(/value=""/g)??[]).length,7);
 assert(html.includes('Agotada'));assert(html.includes('Desactivada'));assert(html.includes('Sin conteo inicial'));assert(html.includes('0 frutas · 0 porciones'));assert(html.includes('Guardar retiros'));
 const workspace=renderToStaticMarkup(createElement(FruitWorkspace,{actor:salon,state,busy:false,error:'',onCommand:async()=>true}));
 assert.equal((workspace.match(/>Registrar retiros</g)??[]).length,1);assert(!workspace.includes('Registrar retiro<span'));assert(!workspace.includes('<th>ACCIONES</th>'));
 const history=renderToStaticMarkup(createElement(FruitWorkspace,{actor:{...salon,role:'admin'},state,busy:false,error:'',historical:true,onCommand:async()=>true}));assert(!history.includes('>Registrar retiros<'));
});
test('el guardado pendiente bloquea todo el formulario múltiple',()=>{
 const s=fixture();const html=renderToStaticMarkup(createElement(FruitBatchWithdrawalDialog,{state:s,shiftId:s.shifts[0].id,busy:true,serverError:'',onSave:async()=>true,onClose:()=>{}}));assert(html.includes('<fieldset class="operation-fields" disabled="">'));assert(html.includes('Guardando…'));
});
test('el almacenamiento JSON persiste todas las frutas y una revisión obsoleta no repite descuentos',async()=>{
 const {mkdir,mkdtemp}=await import('node:fs/promises'),path=await import('node:path');const cwd=process.cwd(),storage=process.env.INVENTORY_STORAGE;
 await mkdir(path.join(cwd,'tmp'),{recursive:true});const directory=await mkdtemp(path.join(cwd,'tmp','fruit-batch-json-'));
 process.chdir(directory);process.env.INVENTORY_STORAGE='json';
 try{const {mutate,getState}=await import('../lib/store');let s=await mutate({type:'restore',revision:0,backup:fixture()});const c=command(s,[{supplyId:'fruta-0',quantity:2},{supplyId:'fruta-1',quantity:1}]);s=await mutate(authorizeCommand(salon,c,s));assert.deepEqual(await getState(),s);assert.equal(stock(s),8);assert.equal(stock(s,'fruta-1'),9);await assert.rejects(()=>mutate(c),/datos cambiaron/);assert.deepEqual(await getState(),s);assert.deepEqual(validateBackup(s),s);}finally{process.chdir(cwd);if(storage===undefined)delete process.env.INVENTORY_STORAGE;else process.env.INVENTORY_STORAGE=storage;}
});
