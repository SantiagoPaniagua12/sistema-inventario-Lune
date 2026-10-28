import type {PoolClient} from 'pg';
import assert from 'node:assert/strict';
export async function migrateCatalog(client:PoolClient){
 await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
 let changed=false;
 const categories=(await client.query("SELECT * FROM categorias WHERE nombre_categoria IN ('Viennoiserie','Bollería') FOR UPDATE")).rows;
 const old=categories.find(c=>c.nombre_categoria==='Viennoiserie'),current=categories.find(c=>c.nombre_categoria==='Bollería');
 if(old){
  if(current){await client.query('UPDATE productos SET id_categoria=$1 WHERE id_categoria=$2',[current.id_categoria,old.id_categoria]);await client.query('DELETE FROM categorias WHERE id_categoria=$1',[old.id_categoria]);}
  else await client.query("UPDATE categorias SET nombre_categoria='Bollería' WHERE id_categoria=$1",[old.id_categoria]);
  changed=true;
 }
 const sachets=[];
 for(const [id,pack,grams,name] of [['insumo-1',500,5,'Azúcar'],['insumo-2',100,1,'Stevia']] as const){
  const item=(await client.query('SELECT * FROM insumos WHERE id_insumo=$1 FOR UPDATE',[id])).rows[0];
  if(!item)continue;
  if(item.unidad!=='sobre'||item.unidades_por_paquete!==pack){
   const updated=(await client.query('UPDATE insumos SET unidad=$1,unidades_por_paquete=$2,observaciones=$3 WHERE id_insumo=$4 RETURNING stock,stock_minimo',['sobre',pack,`Bolsa de ${pack} sobres de ${grams} g. Control por sobres.`,id])).rows[0];
   assert.equal(updated.stock,item.stock);assert.equal(updated.stock_minimo,item.stock_minimo);changed=true;
  }
  sachets.push({name,stock:item.stock===null?null:Number(item.stock),unit:'sobres',packSize:pack});
 }
 const sourceIds=['kombucha-0','kombucha-1','kombucha-2'];
 const sources=(await client.query('SELECT * FROM insumos WHERE id_insumo=ANY($1) ORDER BY id_insumo FOR UPDATE',[sourceIds])).rows;
 let unified=(await client.query("SELECT * FROM insumos WHERE id_insumo='kombuchas' FOR UPDATE")).rows[0];
 let merge='Sin cambios';
 if(sources.length&&sources.every(i=>i.fusionado_en==='kombuchas')){if(!unified)throw new Error('Falta el producto unificado.');merge='Ya unificadas';}
 else if(sources.length){
  if(sources.length!==3||sources.some(i=>i.fusionado_en))throw new Error('La unificación requiere revisar el catálogo de origen.');
  if(unified&&(unified.stock!==null||(await client.query("SELECT 1 FROM movimientos_insumos WHERE id_insumo='kombuchas'")).rowCount))throw new Error('Kombuchas ya tiene conteos; no se combinará automáticamente.');
  const known=sources.every(i=>i.stock!==null),total=known?sources.reduce((n,i)=>n+Number(i.stock),0):null;
  if(total!==null&&total>1000000000)throw new Error('El total excede el límite.');
  const note=known?'Stock unificado de Chill out, Sunset fizz y Emoliente. Historial por sabor conservado.':'Unificación por sabores. Falta confirmar el conteo total real; los saldos anteriores permanecen en el historial.';
  await client.query(`INSERT INTO insumos(id_insumo,nombre,categoria,unidad,stock,stock_minimo,capacidad_ml,unidades_por_paquete,observaciones,estimado,activo) VALUES('kombuchas','Kombuchas','Bebidas','botella',$1,NULL,355,1,$2,false,true) ON CONFLICT(id_insumo) DO UPDATE SET nombre='Kombuchas',stock=$1,observaciones=$2`,[total,note]);
  if(known){
   for(const item of sources){
    if(item.stock>0)await client.query(`INSERT INTO movimientos_insumos(id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable,motivo,estimado) VALUES($1,$2,'salida',$3,$3,0,'Migración de catálogo','Unificación del saldo en Kombuchas',false)`,[crypto.randomUUID(),item.id_insumo,item.stock]);
    await client.query('UPDATE insumos SET stock=0,estimado=false WHERE id_insumo=$1',[item.id_insumo]);
   }
   await client.query(`INSERT INTO movimientos_insumos(id_movimiento,id_insumo,tipo,cantidad,stock_anterior,stock_posterior,responsable,motivo,estimado) VALUES($1,'kombuchas','conteo',$2,NULL,$2,'Migración de catálogo','Suma de saldos confirmados por sabor',false)`,[crypto.randomUUID(),total]);
  }
  await client.query("UPDATE insumos SET activo=false,fusionado_en='kombuchas' WHERE id_insumo=ANY($1)",[sourceIds]);
  changed=true;merge=known?'Saldos confirmados unificados':'Pendiente de conteo real';
 }
 if(changed)await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
 return {changed,sachets,kombuchas:merge};
}
