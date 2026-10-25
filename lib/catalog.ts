import type {Product,State,Row} from './inventory';
import type {Supply} from './supplies';
export function normalizeCategory(value:unknown):Product['category']|undefined{
 return value==='Postres'?'Postres':value==='Bollería'||value==='Viennoiserie'?'Bollería':undefined;
}
export const reserveQuantity=(state:State,id:string)=>state.replenishment?.find(i=>i.productId===id)?.maximum??state.lots.filter(l=>l.productId===id).reduce((sum,l)=>sum+l.quantity,0);
export const displayQuantity=(row:Row)=>row.opening+row.incoming-row.waste;
export function closingCounts(rows:Row[],counts:Record<string,string>){
 const result={...counts};for(const row of rows)if(displayQuantity(row)===0)result[row.productId]='0';return result;
}
export function productDeletionReason(state:State,id:string):string|null{
 if(!state.products.some(p=>p.id===id))return 'El producto no existe.';
 if(state.lots.some(l=>l.productId===id)||state.movements.some(m=>m.productId===id))return 'Tiene producción o movimientos. Puedes desactivarlo para conservar su historial.';
 if(state.excelImports?.some(b=>b.records.some(r=>r.productId===id)))return 'Tiene registros históricos de Excel. Puedes desactivarlo.';
 if(state.shifts.some(s=>s.rows.some(r=>r.productId===id&&(s.status==='closed'||r.opening!==0||r.incoming!==0||r.waste!==0||(r.closing??0)!==0))))return 'Tiene historial de turnos o existencias pendientes. Puedes desactivarlo.';
 return null;
}
export function supplyDeletionReason(state:State,id:string):string|null{
 const item=state.supplies?.find(i=>i.id===id);if(!item)return 'El insumo no existe.';
 if(item.mergedInto||state.supplies?.some(i=>i.mergedInto===id))return 'Forma parte de una unificación que debe conservarse.';
 if((item.stock??0)!==0)return 'Tiene existencias. Puedes desactivarlo para conservar sus registros.';
 if(state.supplyMovements?.some(m=>m.supplyId===id))return 'Tiene movimientos registrados. Puedes desactivarlo.';
 return null;
}
export const packDescription=(item:Supply)=>item.unit==='sobre'?`Bolsa de ${item.packSize} sobres`:item.packSize>1?`${item.packSize} unidades por paquete o millar`:'';
