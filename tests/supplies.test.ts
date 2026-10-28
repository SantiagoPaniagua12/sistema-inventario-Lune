import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, seed, limaDate, type State } from '../lib/inventory';
import { initialSupplies, lowSupplies, supplyDecimalPlaces, formatSupplyQuantity, type Supply } from '../lib/supplies';
import { validateBackup } from '../lib/backup';
import { connectionConfig } from '../lib/connection-config';

const run=(s: State,type: string,data: Record<string,unknown>)=>execute(s,{type,revision:s.revision,...data});
const move=(s: State,supplyId: string,action: string,quantity: number,extra: Record<string,unknown>={})=>run(s,'supplyMove',{supplyId,action,quantity,responsible:'Responsable de prueba',...extra});
test('catálogo confirmado: 48 insumos sin existencias ni mínimos inventados',()=>{
  const items=initialSupplies();
  assert.equal(items.length,48);
  assert.equal(items.filter(i=>i.group==='Frutas congeladas').length,6);
  assert(items.filter(i=>i.group==='Frutas congeladas').every(i=>i.unit==='porcion'&&i.capacityMl===null));
  assert.equal(items.find(i=>i.id==='agua-con-gas')?.capacityMl,355);
  assert.equal(items.find(i=>i.id==='leche-entera')?.capacityMl,1125);
  assert.equal(items.find(i=>i.name==='Leche condensada')?.capacityMl,200);
  assert(items.every(i=>i.stock===null&&i.minimum===null));
  assert.equal(items.filter(i=>['Cocina','Limpieza'].includes(i.group)).length,0);
});
test('frutas por porciones sin mezclarse con los 21 productos del turno',()=>{
  let s=seed();
  s=run(s,'open',{date:limaDate(),period:'Mañana',responsible:'Atención'});
  s=move(s,'fruta-5','conteo',20);
  s=move(s,'fruta-5','salida',3);
  assert.equal(s.supplies?.find(i=>i.id==='fruta-5')?.stock,17);
  assert.equal(s.shifts[0].rows.length,21);
  assert.equal(s.shifts[0].rows.reduce((n,r)=>n+r.incoming,0),0);
  assert.throws(()=>move(s,'fruta-5','salida',18),/suficiente/);
  assert.equal(s.supplies?.find(i=>i.id==='fruta-5')?.stock,17);
});
test('millares de cajas y retiros sueltos conservan el saldo por tamaño',()=>{
  let s=move(seed(),'cajas-pequenas','conteo',0);
  s=move(s,'cajas-pequenas','entrada',2,{byPack:true});
  s=move(s,'cajas-pequenas','salida',35);
  assert.equal(s.supplies?.find(i=>i.id==='cajas-pequenas')?.stock,1965);
  assert.equal(s.supplies?.find(i=>i.id==='cajas-grandes')?.stock,null);
  assert.equal(s.supplyMovements?.[1].quantity,2000);
  assert.throws(()=>move(s,'cajas-pequenas','salida',1,{byPack:true}),/presentación/);
  assert.deepEqual(validateBackup(s),s);
});
test('líquidos: porcentaje estimado, capacidad y conteo medido',()=>{
  let s=run(seed(),'supplyMove',{supplyId:'liquido-0',action:'conteo',percent:25,responsible:'Barra'});
  assert.equal(s.supplies?.find(i=>i.id==='liquido-0')?.stock,150);
  assert.equal(s.supplies?.find(i=>i.id==='liquido-0')?.estimated,true);
  assert.throws(()=>move(s,'liquido-0','entrada',500),/capacidad/);
  assert.throws(()=>move(s,'liquido-0','conteo',200),/motivo/);
  s=move(s,'liquido-0','conteo',200,{note:'Medición con vaso graduado'});
  assert.equal(s.supplies?.find(i=>i.id==='liquido-0')?.estimated,false);
  assert.throws(()=>run(s,'supplyMove',{supplyId:'fruta-0',action:'conteo',percent:50,responsible:'Barra'}),/porcentaje/);
  assert.throws(()=>run(s,'supplyMove',{supplyId:'liquido-5',action:'conteo',percent:101,responsible:'Barra'}),/porcentaje/);
});
test('conteo inicial obligatorio, validación de cantidades y protección del historial',()=>{
  let s=seed();
  assert.throws(()=>move(s,'insumo-0','entrada',2),/conteo inicial/);
  assert.throws(()=>move(s,'insumo-0','conteo',-1),/entero/);
  assert.throws(()=>move(s,'insumo-0','conteo',1.5),/entero/);
  s=move(s,'insumo-0','conteo',4);
  const forged=structuredClone(s);forged.supplyMovements![0].after=8;
  assert.throws(()=>validateBackup(forged),/saldo/);
  assert.throws(()=>execute(s,{type:'supplyMove',revision:0,supplyId:'insumo-0',action:'salida',quantity:1,responsible:'Barra'}),/cambiaron/);
  assert.equal(s.supplies?.find(i=>i.id==='insumo-0')?.stock,4);
});
test('el catálogo admite 240 insumos de cocina con búsqueda por categoría',()=>{
  let s=seed();
  for(let i=0;i<240;i++) s=run(s,'supplyCreate',{name:`Insumo de cocina de prueba ${i}`,group:'Cocina',unit:'paquete',minimum:null});
  assert.equal(s.supplies?.filter(i=>i.group==='Cocina').length,240);
  assert(s.supplies?.filter(i=>i.group==='Cocina').every(i=>i.stock===null));
});
test('reporte: excluye sin conteo, incluye agotados y permite cambiar igualdad',()=>{
  const base=initialSupplies()[0];
  const items: Supply[]=[{...base,id:'a',stock:null,minimum:5},{...base,id:'b',stock:0,minimum:null},{...base,id:'c',stock:1,minimum:1},{...base,id:'d',stock:2,minimum:5},{...base,id:'e',stock:8,minimum:null}];
  assert.deepEqual(lowSupplies(items).map(i=>i.id),['b','d']);
  assert.deepEqual(lowSupplies(items,true).map(i=>i.id),['b','c','d']);
});
test('Supabase exige URI propia, valida TLS y nunca usa las credenciales locales como fallback',()=>{
  assert.throws(()=>connectionConfig({PGPASSWORD:'solo-prueba'},'supabase'),/Falta SUPABASE_DATABASE_URL/);
  const config=connectionConfig({SUPABASE_DATABASE_URL:'postgresql://usuario:prueba@db.example:6543/postgres?sslmode=disable'},'supabase');
  assert.equal(config.max,1);assert.deepEqual(config.ssl,{rejectUnauthorized:true});
  assert(!config.connectionString?.includes('sslmode='));
});


test('las seis infusiones permiten centésimas de bolsa sin cambiar otros insumos',()=>{
  const items=initialSupplies();
  assert.deepEqual(items.filter(item=>supplyDecimalPlaces(item)===2).map(item=>item.id),['infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5']);
  for(const item of items.filter(item=>supplyDecimalPlaces(item)===2)){
    const s=move(seed(),item.id,'conteo',0.5);
    assert.equal(s.supplies!.find(value=>value.id===item.id)!.stock,0.5);
    assert.equal(formatSupplyQuantity(item,0.5),'0.50');
    assert.equal(supplyDecimalPlaces({...item,unit:'unidad'}),0);
    assert.equal(supplyDecimalPlaces({...item,group:'Cocina'}),0);
    assert.equal(supplyDecimalPlaces({...item,id:item.id+'\n'}),0);
  }
  for(const id of ['insumo-0','insumo-1','fruta-0','cajas-pequenas','liquido-0']){
    assert.throws(()=>move(seed(),id,'conteo',0.5),/entero/);
  }
});

test('conteo, ingreso y retiro de bolsas conservan centésimas exactas y el historial',()=>{
  let s=move(seed(),'infusion-4','conteo',0.5);
  s=move(s,'infusion-4','entrada',1);
  s=move(s,'infusion-4','salida',0.1);
  assert.equal(s.supplies!.find(item=>item.id==='infusion-4')!.stock,1.4);
  assert.deepEqual(s.supplyMovements!.slice(0,3).map(m=>[m.action,m.quantity,m.before,m.after]),[
    ['salida',0.1,1.5,1.4],['entrada',1,0.5,1.5],['conteo',0.5,null,0.5],
  ]);
  assert.throws(()=>move(s,'infusion-4','conteo',0.25),/motivo/);
  s=move(s,'infusion-4','conteo',0.25,{note:'Revisión de la bolsa abierta'});
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))),s);
});

test('sumas y retiros pequeños no acumulan residuos binarios',()=>{
  let s=move(seed(),'infusion-0','conteo',0.1);
  s=move(s,'infusion-0','entrada',0.2);
  assert.equal(s.supplies!.find(item=>item.id==='infusion-0')!.stock,0.3);
  for(let i=0;i<30;i++)s=move(s,'infusion-0','salida',0.01);
  assert.equal(s.supplies!.find(item=>item.id==='infusion-0')!.stock,0);
  assert.throws(()=>move(s,'infusion-0','salida',0.01),/suficiente/);
  s=move(s,'infusion-0','entrada',0.29);
  s=move(s,'infusion-0','salida',0.29);
  assert.equal(s.supplies!.find(item=>item.id==='infusion-0')!.stock,0);
  assert.deepEqual(validateBackup(s),s);
});

test('las cantidades fraccionadas validan precisión, límites y conteo inicial',()=>{
  assert.throws(()=>move(seed(),'infusion-0','entrada',0.01),/conteo inicial/);
  for(const quantity of [-0.01,0.001,0.301,NaN,Infinity,1_000_000_000.01]){
    assert.throws(()=>move(seed(),'infusion-0','conteo',quantity),/decimales/);
  }
  const s=move(seed(),'infusion-0','conteo',0.5);
  for(const action of ['entrada','salida'])assert.throws(()=>move(s,'infusion-0',action,0),/mínimo 0.01/);
  assert.throws(()=>move(s,'infusion-0','salida',0.51),/suficiente/);
  assert.throws(()=>move(s,'infusion-0','entrada',0.5,{byPack:true}),/presentación/);
  const max=move(seed(),'infusion-0','conteo',1_000_000_000);
  assert.throws(()=>move(max,'infusion-0','entrada',0.01),/Stock resultante/);
  assert.equal(move(max,'infusion-0','salida',0.01).supplies!.find(item=>item.id==='infusion-0')!.stock,999_999_999.99);
  assert.equal(s.supplies!.find(item=>item.id==='infusion-0')!.stock,0.5);
});

test('mínimos decimales de infusiones conservan alertas y permiten renombrar',()=>{
  let s=move(seed(),'infusion-2','conteo',0.25);
  s=run(s,'supplyUpdate',{supplyId:'infusion-2',name:'Taza de Amor a granel',minimum:0.25});
  const item=s.supplies!.find(value=>value.id==='infusion-2')!;
  assert.equal(item.minimum,0.25);
  assert.equal(formatSupplyQuantity(item,item.minimum!),'0.25');
  assert(!lowSupplies(s.supplies!).some(value=>value.id===item.id));
  assert(lowSupplies(s.supplies!,true).some(value=>value.id===item.id));
  s=move(s,item.id,'salida',0.01);
  assert(lowSupplies(s.supplies!).some(value=>value.id===item.id));
  assert.throws(()=>run(s,'supplyUpdate',{supplyId:item.id,name:item.name,minimum:0.251}),/decimales/);
  assert.throws(()=>run(s,'supplyUpdate',{supplyId:'insumo-0',name:'Café',minimum:0.25}),/entero/);
  assert.deepEqual(validateBackup(s),s);
});

test('restauración conserva respaldos enteros y rechaza fracciones o saldos alterados',()=>{
  const legacy=move(seed(),'infusion-3','conteo',2);
  assert.deepEqual(validateBackup(legacy),legacy);
  let s=move(seed(),'infusion-3','conteo',0.3);
  s=move(s,'infusion-3','salida',0.1);
  const badPrecision=structuredClone(s);badPrecision.supplyMovements![0].quantity=0.101;
  assert.throws(()=>validateBackup(badPrecision),/decimales/);
  const badStock=structuredClone(s);badStock.supplies!.find(item=>item.id==='infusion-3')!.stock=0.201;
  assert.throws(()=>validateBackup(badStock),/decimales/);
  const badBalance=structuredClone(s);badBalance.supplyMovements![0].after=0.21;
  assert.throws(()=>validateBackup(badBalance),/saldo/);
  const wrongUnit=structuredClone(s);wrongUnit.supplies!.find(item=>item.id==='infusion-3')!.unit='unidad';
  assert.throws(()=>validateBackup(wrongUnit),/entero/);
});
