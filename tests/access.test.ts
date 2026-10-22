import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCommand,AccessError,type Actor} from '../lib/access';
import {accountFields,assertAccountChange} from '../lib/account-management';
import {seed,type Command} from '../lib/inventory';
import {readJson} from '../lib/http-security';
import {loginArea} from '../lib/area-accounts';
const actor=(role:Actor['role'],name=role==='cocina'?'Cocina':'Salón'):Actor=>({id:'id',name,role,mustChangePassword:false});
const command=(type:string,extra:Record<string,unknown>={}):Command=>({type,revision:0,...extra});
test('cocina no puede abrir turnos, cambiar catálogos, importar ni restaurar',()=>{
  for(const type of ['open','replenish','close','correctShift','product','createProduct','excelImport','restore','supplyCreate','supplyUpdate','unknown']) assert.throws(()=>authorizeCommand(actor('cocina'),command(type),seed()),AccessError);
  assert.equal(authorizeCommand(actor('cocina'),command('produce',{responsible:'Joel'}),seed()).responsible,'Joel');
  for(const responsible of [undefined,'Salón','Karla','Intruso'])assert.throws(()=>authorizeCommand(actor('cocina'),command('produce',{responsible}),seed()),AccessError);
});
test('salón no puede producir ni modificar catálogos y selecciona un mozo válido',()=>{
  assert.equal(authorizeCommand(actor('mozo'),command('correctShift',{responsible:'Karla'}),seed()).responsible,'Karla');
  assert.throws(()=>authorizeCommand(actor('mozo'),command('correctShift',{responsible:'Alex'}),seed()),AccessError);
  for(const type of ['produce','product','createProduct','excelImport','restore','supplyCreate','supplyUpdate']) assert.throws(()=>authorizeCommand(actor('mozo'),command(type),seed()),AccessError);
  assert.equal(authorizeCommand(actor('mozo'),command('open',{responsible:'Shalu'}),seed()).responsible,'Shalu');
  assert.throws(()=>authorizeCommand(actor('mozo'),command('open',{responsible:'Alex'}),seed()),AccessError);
});
test('salón puede registrar otro mozo en la reposición sin cambiar quién abrió el turno',()=>{
  const state=seed();state.shifts.push({id:'s',date:'2026-10-22',period:'Mañana',responsible:'Shalu',status:'open',rows:[]});
  for(const type of ['close','replenish']){
    assert.equal(authorizeCommand(actor('mozo'),command(type,{responsible:'Karla'}),state).responsible,'Karla');
    assert.equal(state.shifts[0].responsible,'Shalu');
    assert.throws(()=>authorizeCommand(actor('mozo'),command(type),state),AccessError);
    assert.throws(()=>authorizeCommand(actor('mozo'),command(type,{responsible:'Alex'}),state),AccessError);
    assert.equal(authorizeCommand(actor('admin'),command(type,{responsible:'Karla'}),state).type,type);
  }
});
test('insumos respetan el área y exigen seleccionar a alguien de su equipo',()=>{
  const state=seed();state.supplies!.push({id:'k',name:'Harina',group:'Cocina',unit:'bolsa',stock:null,minimum:null,capacityMl:null,packSize:1,note:'',estimated:false});
  assert.throws(()=>authorizeCommand(actor('mozo'),command('supplyMove',{supplyId:'k'}),state),AccessError);
  assert.throws(()=>authorizeCommand(actor('cocina'),command('supplyMove',{supplyId:'k',responsible:'Karla'}),state),AccessError);
  assert.equal(authorizeCommand(actor('cocina'),command('supplyMove',{supplyId:'k',responsible:'Alex'}),state).responsible,'Alex');
  const beverage=state.supplies!.find(i=>i.group==='Bebidas')!;
  assert.throws(()=>authorizeCommand(actor('cocina'),command('supplyMove',{supplyId:beverage.id}),state),AccessError);
  assert.throws(()=>authorizeCommand(actor('mozo'),command('supplyMove',{supplyId:'missing'}),state),AccessError);
});
test('el cambio de contraseña obligatorio no se evita cambiando de comando',()=>{
  for(const role of ['admin','cocina','mozo'] as const)assert.throws(()=>authorizeCommand({...actor(role),mustChangePassword:true},command('produce'),seed()),AccessError);
});
test('perfiles de trabajo son cuentas de área y no cuentas personales',()=>{
  assert.equal(accountFields({name:'Cocina',email:'A@example.com',role:'cocina'}).email,'a@example.com');
  for(const data of [{name:'Shalu',email:'s@example.com',role:'cocina'},{name:'Alex',email:'a@example.com',role:'mozo'},{name:'Alex',email:'invalid',role:'admin'},{name:'Alex',email:'a@example.com',role:'superadmin'}])assert.throws(()=>accountFields(data),AccessError);
  assert.throws(()=>assertAccountChange('a','a','admin',false,true,2),AccessError);
  assert.throws(()=>assertAccountChange('a','b','mozo',true,true,1),AccessError);
  assert.doesNotThrow(()=>assertAccountChange('a','b','admin',false,true,2));
});
test('el inicio acepta cocina, salón y mozos; el correo de administración sigue siendo correo',()=>{
  assert.equal(loginArea('Cocina'),'cocina');assert.equal(loginArea(' Salón '),'mozo');assert.equal(loginArea('salon'),'mozo');assert.equal(loginArea('mozos'),'mozo');
  for(const value of ['admin','Alex','Shalu','lunealtapasteleria@gmail.com'])assert.equal(loginArea(value),undefined);
});
test('el cuerpo JSON se limita antes de parsearlo, incluso sin Content-Length',async()=>{
  await assert.rejects(()=>readJson(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:'x'.repeat(100)})}),30),(e:unknown)=>e instanceof AccessError&&e.status===413);
  await assert.rejects(()=>readJson(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'})),AccessError);
  await assert.rejects(()=>readJson(new Request('http://localhost',{method:'POST',body:'{}'})),(e:unknown)=>e instanceof AccessError&&e.status===415);
  assert.deepEqual(await readJson(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"ok":true}'})),{ok:true});
});
