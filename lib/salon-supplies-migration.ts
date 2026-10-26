import type {PoolClient} from 'pg';
import {salonSupplies,supplyNameKey} from './salon-supplies';
/** Reuses matching items regardless of category, keeping IDs, balances and history. */
export async function addSalonSupplies(client:PoolClient){
 await client.query('SELECT pg_advisory_xact_lock(20261018,5433)');
 const existing=(await client.query('SELECT * FROM insumos FOR UPDATE')).rows;
 const added:string[]=[],reclassified:string[]=[],retained:string[]=[];
 for(const item of salonSupplies()){
  const matches=existing.filter(row=>supplyNameKey(row.nombre)===supplyNameKey(item.name));
  if(matches.length>1)throw new Error('Hay nombres repetidos que requieren revisión antes de añadir insumos.');
  const found=matches[0];
  if(found){
   if(found.fusionado_en)throw new Error('Un insumo coincide con un producto unificado.');
   if(found.unidad!==item.unit)throw new Error('Un producto existente usa otra unidad. Se requiere revisar su conteo.');
   if(found.categoria!==item.group){await client.query('UPDATE insumos SET categoria=$1 WHERE id_insumo=$2',[item.group,found.id_insumo]);reclassified.push(found.nombre);}
   else retained.push(found.nombre);
  }else{
   if(existing.some(row=>row.id_insumo===item.id))throw new Error('Hay un identificador de catálogo ocupado.');
   await client.query(`INSERT INTO insumos(id_insumo,nombre,categoria,unidad,stock,stock_minimo,capacidad_ml,unidades_por_paquete,observaciones,estimado,activo) VALUES($1,$2,$3,$4,NULL,NULL,NULL,1,$5,false,true)`,[item.id,item.name,item.group,item.unit,item.note]);
   added.push(item.name);
  }
 }
 if(added.length||reclassified.length)await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
 return {added,reclassified,retained};
}
