import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, seed, limaDate, type State } from '../lib/inventory';
import { initialSupplies, lowSupplies, type Supply } from '../lib/supplies';
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
