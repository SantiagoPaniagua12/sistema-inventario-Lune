import {oldestAvailableLot,limaDate,type State,type Product,type Command,type Movement} from './inventory';
export type BakedLot={productId:string;lotId:string;quantity:number;bakedAt:string};
export const isKitchenProduct=(p:Pick<Product,'name'|'kitchenOnly'>)=>p.kitchenOnly===true||['focaccia','pan para tostada','pan para tostadas'].includes(p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());
export const bakedQuantity=(s:State,id:string)=>(s.baked??[]).filter(l=>l.productId===id).reduce((n,l)=>n+l.quantity,0);
export const oldestBakedLot=(s:State,id:string)=>(s.baked??[]).filter(l=>l.productId===id&&l.quantity>0).sort((a,b)=>a.bakedAt.localeCompare(b.bakedAt)||a.lotId.localeCompare(b.lotId))[0];
export function changeBaked(s:State,productId:string,lotId:string,delta:number,at=new Date().toISOString()){
 s.baked??=[];let lot=s.baked.find(l=>l.lotId===lotId&&l.productId===productId);
 if(!lot){lot={productId,lotId,quantity:0,bakedAt:at};s.baked.push(lot);}
 const next=lot.quantity+delta;if(!Number.isSafeInteger(next)||next<0||next>100000)throw new Error('No hay suficientes unidades horneadas o se supera el límite.');lot.quantity=next;
 if(bakedQuantity(s,productId)>100000)throw new Error('El stock horneado supera el límite permitido.');
}
export function executeBaking(original:State,c:Command):State{
 if(c.revision!==original.revision)throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
 const s=structuredClone(original),responsible=typeof c.responsible==='string'?c.responsible.trim():'';
 if(!responsible||responsible.length>80)throw new Error('Selecciona al cocinero responsable.');
 const serviceDate=typeof c.date==='string'?c.date:limaDate();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||!Number.isFinite(Date.parse(serviceDate))||new Date(serviceDate).toISOString().slice(0,10)!==serviceDate||serviceDate>limaDate())throw new Error('Fecha de cocina inválida o futura.');
 if(c.period!=='Mañana'&&c.period!=='Tarde')throw new Error('Selecciona el turno de Cocina.');
 const items=c.type==='bakeBatch'?c.items:[{productId:c.productId,quantity:c.quantity}];
 if(!Array.isArray(items)||!items.length||items.length>s.products.length)throw new Error('Selecciona productos y cantidades.');
 const seen=new Set<string>();
 for(const item of items){
  const p=s.products.find(p=>p.id===item?.productId),quantity=item?.quantity;
  if(!p||p.category!=='Bollería'||seen.has(p.id))throw new Error('Selecciona productos de bollería sin repetir.');seen.add(p.id);
  if(c.type==='bakeBatch'&&p.active===false)throw new Error('El producto está desactivado para nuevos horneados.');
  if(c.type==='useBaked'&&!isKitchenProduct(p))throw new Error('Solo focaccia y pan para tostadas admiten uso en platos.');
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)throw new Error('La cantidad debe ser un entero entre 1 y 100000.');
  const available=c.type==='bakeBatch'?s.lots.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.quantity,0):bakedQuantity(s,p.id);
  if(available<quantity)throw new Error(c.type==='bakeBatch'?'No hay suficientes unidades congeladas.':'No hay suficientes unidades horneadas.');
  let pending=quantity;
  while(pending){
   const lot=c.type==='bakeBatch'?oldestAvailableLot(s.lots,p.id)!:oldestBakedLot(s,p.id)!;
   const lotId='id' in lot?lot.id:lot.lotId,q=Math.min(pending,lot.quantity),at=new Date().toISOString();
   if(c.type==='bakeBatch'){lot.quantity-=q;changeBaked(s,p.id,lotId,q,at);}else changeBaked(s,p.id,lotId,-q);
   const log:Movement={id:crypto.randomUUID(),at,productId:p.id,lotId,type:c.type==='bakeBatch'?'Horneado en cocina':'Uso en platos',quantity:q,responsible,note:typeof c.note==='string'?c.note.trim().slice(0,180):'',serviceDate,period:c.period};
   s.movements.unshift(log);pending-=q;
  }
 }
 s.revision++;return s;
}
