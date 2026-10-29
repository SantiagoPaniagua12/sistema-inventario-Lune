import {shiftTeam,type Command,type State} from './inventory';
import {unitLabel} from './supplies';
export const HISTORY_KINDS=['Turnos','Mostrador','Producción','Insumos','Catálogo','Importaciones','Otros'] as const;
export type HistoryKind=typeof HISTORY_KINDS[number];
export type HistoryItem={name:string;quantity:number|null;unit:string;before?:number|null;after?:number|null};
export type OperationSummary={shift?:{id:string;date:string;period:string};responsibles:string[];items:HistoryItem[];note:string;supplyMovementIds:string[]};
export type HistoryEntry={id:string;at:string;account:string;area:string;action:string;label:string;kind:HistoryKind;summary:OperationSummary;legacy:boolean};
export type HistoryPage={entries:HistoryEntry[];nextCursor:string|null};
export const ACTIONS:Record<string,{label:string;kind:HistoryKind}>={
 bakeBatch:{label:'Horneado registrado por Cocina',kind:'Producción'},useBaked:{label:'Unidades usadas en platos',kind:'Producción'},
 productStatus:{label:'Estado de producto actualizado',kind:'Catálogo'},productDelete:{label:'Producto eliminado sin historial',kind:'Catálogo'},supplyStatus:{label:'Estado de insumo actualizado',kind:'Catálogo'},supplyDelete:{label:'Insumo eliminado sin historial',kind:'Catálogo'},
 open:{label:'Apertura de turno',kind:'Turnos'},close:{label:'Cierre de turno',kind:'Turnos'},addWaiters:{label:'Mozos agregados al turno',kind:'Turnos'},replaceWaiter:{label:'Cambio de mozo del turno',kind:'Turnos'},
 replenish:{label:'Ingreso al mostrador',kind:'Mostrador'},replenishBatch:{label:'Ingreso de productos al mostrador',kind:'Mostrador'},correctShift:{label:'Corrección de ingreso o cierre',kind:'Mostrador'},
 adjustReserve:{label:'Ajuste de reserva congelada',kind:'Producción'},
 produce:{label:'Producción registrada',kind:'Producción'},produceBatch:{label:'Producción de productos',kind:'Producción'},correctProduction:{label:'Corrección de producción',kind:'Producción'},
 supplyMove:{label:'Movimiento de insumo',kind:'Insumos'},supplyUpdate:{label:'Insumo actualizado',kind:'Insumos'},supplyCreate:{label:'Insumo creado',kind:'Insumos'},
 product:{label:'Producto actualizado',kind:'Catálogo'},createProduct:{label:'Producto creado',kind:'Catálogo'},excelImport:{label:'Importación histórica de Excel',kind:'Importaciones'},
};
export function operationSummary(before:State,after:State,command:Command):OperationSummary{
 const active=before.shifts.find(s=>s.status==='open');
 const shift=command.type==='open'?after.shifts.at(-1):command.type.startsWith('supply')||['product','createProduct','productStatus','productDelete','excelImport','bakeBatch','useBaked'].includes(command.type)?undefined:after.shifts.find(s=>s.id===(command.shiftId??active?.id));
 const previousIds=new Set(before.movements.map(m=>m.id));
 const logs=after.movements.filter(m=>!previousIds.has(m.id));
 const supplyIds=new Set(before.supplyMovements?.map(m=>m.id));
 const supplyLogs=after.supplyMovements?.filter(m=>!supplyIds.has(m.id))??[];
 let items:HistoryItem[]=[];
 if(['open','close'].includes(command.type)&&shift)items=shift.rows.map(row=>({name:after.products.find(p=>p.id===row.productId)?.name??'Producto',quantity:command.type==='open'?row.opening:row.closing,unit:command.type==='open'?'unidades de entrada':'unidades al cierre'}));
 else if(command.type==='correctShift'){
   const row=shift?.rows.find(r=>r.productId===command.productId),old=before.shifts.find(s=>s.id===shift?.id)?.rows.find(r=>r.productId===command.productId);
   const name=after.products.find(p=>p.id===command.productId)?.name??'Producto';
   if(row&&old){items=[{name,quantity:row.incoming,unit:'ingreso total',before:old.incoming,after:row.incoming}];if(shift?.status==='closed')items.push({name,quantity:row.closing,unit:'salida',before:old.closing,after:row.closing});}
 }else if(command.type==='adjustReserve'){
   const total=(s:State)=>s.lots.filter(l=>l.productId===command.productId).reduce((n,l)=>n+l.quantity,0);
   items=[{name:after.products.find(p=>p.id===command.productId)?.name??'Producto',quantity:total(after)-total(before),unit:'unidades',before:total(before),after:total(after)}];
 }else if(command.type==='correctProduction'){
   const lot=after.lots.find(l=>l.id===command.lotId),old=before.lots.find(l=>l.id===command.lotId);
   if(lot&&old)items=[{name:after.products.find(p=>p.id===lot.productId)?.name??'Producto',quantity:lot.producedQuantity??null,unit:'unidades producidas',before:old.producedQuantity??null,after:lot.producedQuantity??null}];
 }else if(supplyLogs.length)items=supplyLogs.map(m=>({name:after.supplies?.find(s=>s.id===m.supplyId)?.name??'Insumo',quantity:m.quantity,unit:unitLabel(after.supplies?.find(s=>s.id===m.supplyId)?.unit??'unidad'),before:m.before,after:m.after}));
 else if(logs.length)items=after.products.flatMap(p=>{const matching=logs.filter(m=>m.productId===p.id);return matching.length?[{name:p.name,quantity:matching.reduce((n,m)=>n+m.quantity,0),unit:'unidades'}]:[];});
 else if(command.type==='productDelete'||command.type==='supplyDelete'){const name=before.products.find(p=>p.id===command.productId)?.name??before.supplies?.find(s=>s.id===command.supplyId)?.name;if(name)items=[{name,quantity:null,unit:''}];}
 else if(command.productId||command.supplyId){const name=after.products.find(p=>p.id===command.productId)?.name??after.supplies?.find(s=>s.id===command.supplyId)?.name; if(name)items=[{name,quantity:null,unit:''}];}
 const team=command.type==='adjustReserve'||command.type==='produce'||command.type==='produceBatch'||command.type==='correctProduction'||command.type==='bakeBatch'||command.type==='useBaked'?[String(command.responsible)]:shift?shiftTeam(shift):typeof command.responsible==='string'?[command.responsible]:[];
 return {responsibles:team,items,note:[['bakeBatch','useBaked'].includes(command.type)?`Cocina: ${String(command.date)} · ${String(command.period)}`:'',['productStatus','supplyStatus'].includes(command.type)?(command.active?'Producto activado':'Producto desactivado'):command.type==='replaceWaiter'?`Reemplazo: ${String(command.outgoing)} → ${String(command.replacement)}`:command.type==='supplyMove'?command.action:command.type==='addWaiters'&&Array.isArray(command.names)?'Se incorporan: '+command.names.join(', '):'',typeof command.reason==='string'?command.reason:typeof command.note==='string'?command.note:''].filter(Boolean).join(' · '),supplyMovementIds:supplyLogs.map(m=>m.id),...(shift?{shift:{id:shift.id,date:shift.date,period:shift.period}}:{})};
}
/** Legacy events keep only known audit data; never infer an account from a name. */
export function legacySummary(detail:Record<string,unknown>,state:State):OperationSummary{
 const items:HistoryItem[]=[];
 if(Array.isArray(detail.items))for(const item of detail.items){if(!item||typeof item!=='object')continue;const value=item as Record<string,unknown>;const p=state.products.find(p=>p.id===value.productId);if(p)items.push({name:p.name,quantity:typeof value.quantity==='number'?value.quantity:null,unit:'unidades'});}
 if(!items.length){const p=state.products.find(p=>p.id===detail.productId),s=state.supplies?.find(s=>s.id===detail.supplyId);if(p||s)items.push({name:(p?.name??s?.name)!,quantity:null,unit:''});}
 const shift=state.shifts.find(s=>s.id===detail.shiftId);
 return {items,responsibles:Array.isArray(detail.responsables)?detail.responsables.filter((n):n is string=>typeof n==='string'):typeof detail.responsable==='string'?[detail.responsable]:[],note:typeof detail.reason==='string'?detail.reason:'',supplyMovementIds:[],...(shift?{shift:{id:shift.id,date:shift.date,period:shift.period}}:{})};
}
