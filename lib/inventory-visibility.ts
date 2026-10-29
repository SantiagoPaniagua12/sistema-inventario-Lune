import {isKitchenProduct,bakedQuantity} from './baking';
import type {Actor,Role} from './access';
import type {State} from './inventory';
import {allSalesShifts} from './excel-history';
export const INVENTORY_SECTIONS=['Turno actual','Reserva congelada','Horneados','Historial','Productos','Insumos y bebidas','Limpieza','Ventas por turno','Salidas al mostrador','Alertas de inventario','Importar Excel'] as const;
export type InventorySection=typeof INVENTORY_SECTIONS[number];
export function canViewSection(role:Role,section:InventorySection){
  if(role==='admin')return true;
  if(section==='Productos'||section==='Importar Excel')return false;
  if(role==='mozo')return section!=='Reserva congelada'&&section!=='Salidas al mostrador'&&section!=='Horneados';
  return section!=='Turno actual'&&section!=='Ventas por turno';
}
/** Never use the restricted view for stock mutations or backups. */
export function visibleInventory(state:State,actor:Actor,ownSupplyMovementIds:ReadonlySet<string>=new Set()):State{
  if(actor.role==='admin')return state;
  const common={revision:state.revision,products:state.products,supplies:state.supplies,
    supplyMovements:state.supplyMovements?.filter(m=>ownSupplyMovementIds.has(m.id)),movements:[],excelImports:[]};
  if(actor.role==='mozo')return {...common,products:state.products.map(({reserveMinimum:_private,...product})=>product),
    excelImports:state.excelImports?.map(batch=>({...batch,records:batch.records.filter(r=>r.kind==='turno')})).filter(batch=>batch.records.length),
    shifts:state.shifts,lots:[],visibility:{display:true,reserve:false},
    replenishment:state.products.filter(p=>!isKitchenProduct(p)).map(p=>({productId:p.id,maximum:p.category==='Bollería'?bakedQuantity(state,p.id):state.lots.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.quantity,0)}))};
  return {...common,baked:state.baked,movements:state.movements.filter(m=>m.type==='Horneado en cocina'||m.type==='Uso en platos'),lots:state.lots,shifts:[],visibility:{display:false,reserve:true},
    transferShifts:allSalesShifts(state).map(s=>({id:s.id,date:s.date,period:s.period,status:s.status,rows:s.rows.map(r=>({productId:r.productId,incoming:r.incoming}))}))};
}
