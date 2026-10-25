import {loadEnvConfig} from '@next/env';
import assert from 'node:assert/strict';
import {getPgPool} from '../lib/postgres';
import {getPostgresState,mutatePostgres} from '../lib/postgres-store';
loadEnvConfig(process.cwd());
async function main(){
  if(process.env.INVENTORY_STORAGE!=='supabase')throw new Error('Este comando requiere la conexión activa de Supabase.');
  const before=await getPostgresState();
  const name='Croissant de almendras';
  const existing=before.products.find(p=>p.name.toLocaleLowerCase('es-PE')===name.toLocaleLowerCase('es-PE'));
  if(existing){console.log('El croissant de almendras ya existe. No se duplicó ni modificó su stock.');return;}
  const result=await getPgPool().query("SELECT auth_id,nombre FROM perfiles_acceso WHERE rol='admin' AND activo AND NOT cambiar_password AND email=$1",['lunealtapasteleria@gmail.com']);
  if(result.rowCount!==1)throw new Error('No se encontró la administración autorizada.');
  const admin=result.rows[0];
  const after=await mutatePostgres({type:'createProduct',revision:before.revision,name,category:'Bollería',yield:1,minimum:1,reserveMinimum:null},{id:admin.auth_id,name:admin.nombre,role:'admin',mustChangePassword:false});
  assert.equal(after.products.length,before.products.length+1);
  assert.deepEqual(after.lots,before.lots);assert.deepEqual(after.movements,before.movements);
  assert.deepEqual(after.supplies,before.supplies);assert.deepEqual(after.supplyMovements,before.supplyMovements);
  const product=after.products.find(p=>p.name===name)!;
  for(const shift of before.shifts){const current=after.shifts.find(s=>s.id===shift.id)!;if(shift.status==='closed')assert.deepEqual(current,shift);else{assert.deepEqual(current.rows.filter(r=>r.productId!==product.id),shift.rows);assert.deepEqual(current.rows.find(r=>r.productId===product.id),{productId:product.id,opening:0,incoming:0,waste:0,closing:null});}}
  console.log(`Producto agregado: ${name}. Catálogo: ${after.products.length}. Mínimo mostrador: 1. Reserva sin mínimo definido. Sin existencias inventadas; cierres anteriores conservados.`);
}
main().catch(()=>{console.error('No se pudo completar el alta. Revisa la conexión y el catálogo antes de reintentar. No se imprimen credenciales.');process.exitCode=1;}).finally(()=>getPgPool().end());
