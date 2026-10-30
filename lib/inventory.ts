import {executeFruitCommand,isFruitCommand} from './fruit-withdrawals';
import {executeBaking,isKitchenProduct,bakedQuantity,oldestBakedLot,changeBaked,type BakedLot} from './baking';
import { initialSupplies, executeSupplyCommand, type Supply, type SupplyMovement } from './supplies';
import { executeExcelImport, type ExcelImport } from './excel-history';
import {WAITERS} from './staff';
import {normalizeCategory,productDeletionReason,reserveQuantity} from './catalog';

export type Product = { kitchenOnly?:boolean; active?:boolean; id: string; name: string; category: 'Postres' | 'Bollería'; yield: number; minimum: number; reserveMinimum?: number | null };
export type LotDateCorrection={id:string;lotId:string;productId:string;previousDate:string;date:string;responsible:string;reason:string;at:string};
export type Lot = { id: string; productId: string; quantity: number; producedAt: string; note: string; yield?: number; responsible?: string; producedQuantity?:number };
export type Row = { productId: string; opening: number; incoming: number; waste: number; closing: number | null };
export type Shift = { id: string; date: string; period: 'Mañana' | 'Tarde'; responsible: string; responsibles?:string[]; status: 'open' | 'closed'; rows: Row[]; openedAt?: string; closedAt?: string };
export type Movement = { source?:'horneados'; serviceDate?:string; period?:'Mañana'|'Tarde'; id: string; at: string; productId: string; type: string; quantity: number; note: string; responsible: string; responsibles?:string[]; shiftId?: string; lotId?: string };
export type TransferShift = Pick<Shift,'id'|'date'|'period'|'status'> & {rows: Pick<Row,'productId'|'incoming'>[]};
export type State = { lotDateCorrections?:LotDateCorrection[]; baked?:BakedLot[]; revision: number; products: Product[]; lots: Lot[]; shifts: Shift[]; movements: Movement[]; supplies?: Supply[]; supplyMovements?: SupplyMovement[]; excelImports?: ExcelImport[];
  replenishment?:{productId:string;maximum:number}[];transferShifts?:TransferShift[];visibility?:{display:boolean;reserve:boolean} };
export type Command = { type: string; revision: number; [key: string]: unknown };
export const limaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const uid = () => crypto.randomUUID();
export const available = (r: Row) => r.opening + r.incoming - r.waste;
export const sales = (r: Row) => r.closing === null ? null : available(r) - r.closing;
export const shiftTeam = (shift:Shift):string[] => shift.responsibles?.length ? [...shift.responsibles] : [shift.responsible];
export const shiftLabel = (shift:Shift):string => shiftTeam(shift).join(', ');
export function waiterNames(value:unknown,min=1):string[]{
  if(!Array.isArray(value)||value.length<min||value.length>4||value.some(name=>typeof name!=='string'||!(WAITERS as readonly string[]).includes(name)))throw new Error(`Selecciona entre ${min} y 4 mozos de la lista.`);
  const names=value as string[];
  if(new Set(names).size!==names.length)throw new Error('Los nombres de los mozos no pueden repetirse.');
  return [...names];
}
// Array order breaks ties by registration order (PostgreSQL reads lots by id).
export const oldestAvailableLot = (lots: Lot[], productId: string) => lots.filter(l => l.productId === productId && l.quantity > 0).sort((a,b) => a.producedAt.localeCompare(b.producedAt))[0];
export const personKey = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
export function seed(): State {
  const names = ['Sacher de Tumbo', 'Choux de Maracuya', 'Choux de Café', 'Tartaleta de Limón', 'Vainilla Cacao', 'Tiramisu', 'Tartaleta de Toffe', 'Pastel de Queso Japones', 'Delicia Multifloral', 'Ciudad Blanca', 'Amor Eterno', 'Charlotte de Lucuma', 'Flor Andina', 'Entremet', 'Kaori del Valle', 'Coco Mango', 'Pistacho Rose'];
  const products: Product[] = names.map((name, i) => ({ id: `p${i + 1}`, name, category: 'Postres', yield: 1, minimum: 1 }));
  products.push(...['Croissant clásico', 'Croissant de chocolate', 'Roll de canela', 'Croissant de almendras'].map((name, i): Product => ({ id: `v${i + 1}`, name, category: 'Bollería', yield: 1, minimum: 1 })));
  return { revision: 0, products, lots: [], shifts: [], movements: [], supplies: initialSupplies(), supplyMovements: [] };
}
function integer(value: unknown, label: string, min = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 100000) throw new Error(`${label}: ingresa un entero entre ${min} y 100000.`);
  return value;
}
function required(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 180) throw new Error(`${label} es obligatorio (máximo 180 caracteres).`);
  return value.trim();
}
export function execute(original: State, c: Command): State {
  if(isFruitCommand(c.type))return executeFruitCommand(original,c);
  if(c.type==='bakeBatch'||c.type==='useBaked')return executeBaking(original,c);
  if (c.type === 'excelImport') return executeExcelImport(original, c);
  if (typeof c.type === 'string' && c.type.startsWith('supply')) return executeSupplyCommand(original, c);
  if (c.revision !== original.revision) throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
  if(c.type==='produceBatch'||c.type==='replenishBatch'){
    if(!Array.isArray(c.items)||!c.items.length||c.items.length>original.products.length)throw new Error('Ingresa al menos un producto y su cantidad.');
    const seen=new Set<string>();
    const items=c.items.map(item=>{
      if(!item||typeof item!=='object')throw new Error('Producto inválido.');
      const data=item as Record<string,unknown>;
      if(typeof data.productId!=='string'||!original.products.some(p=>p.id===data.productId)||seen.has(data.productId))throw new Error('Revisa los productos: no pueden repetirse.');
      seen.add(data.productId);
      return {productId:data.productId,quantity:integer(data.quantity,'Cantidad',1)};
    });
    let next=original;
    const active=original.shifts.find(shift=>shift.status==='open');
    for(const item of items){
      if(c.type==='produceBatch')next=execute(next,{type:'produce',revision:next.revision,...item,date:c.date,responsible:c.responsible});
      else{
        if(!active)throw new Error('Necesitas un turno abierto.');
        const baked=next.products.find(p=>p.id===item.productId)!.category==='Bollería';
        const stock=baked?bakedQuantity(next,item.productId):next.lots.filter(lot=>lot.productId===item.productId).reduce((sum,lot)=>sum+lot.quantity,0);
        if(stock<item.quantity)throw new Error(`${original.products.find(p=>p.id===item.productId)!.name}: no hay suficiente stock en reserva (${stock} disponibles).`);
        let remaining=item.quantity;
        while(remaining){
          const lot=baked?oldestBakedLot(next,item.productId)!:oldestAvailableLot(next.lots,item.productId)!;
          const quantity=Math.min(remaining,lot.quantity);
          next=execute(next,{type:'replenish',revision:next.revision,productId:item.productId,lotId:'id' in lot?lot.id:lot.lotId,quantity,responsible:shiftTeam(active)[0]});
          remaining-=quantity;
        }
      }
    }
    return {...next,revision:original.revision+1};
  }
  const s = structuredClone(original);
  const active = s.shifts.find(x => x.status === 'open');
  const product = s.products.find(x => x.id === c.productId);
  const log = (type: string, quantity: number, note: string, responsible: string) => s.movements.unshift({ id: uid(), at: new Date().toISOString(), productId: product!.id, type, quantity, note, responsible, ...(active ? { shiftId: active.id } : {}) });
  if (c.type === 'open') {
    if (active) throw new Error('Ya hay un turno abierto.');
    const date = required(c.date, 'Fecha');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Fecha inválida.');
    if (date > limaDate()) throw new Error('No puedes abrir un turno futuro.');
    if (c.period !== 'Mañana' && c.period !== 'Tarde') throw new Error('Turno inválido.');
    if (s.excelImports?.some(batch=>batch.records.some(row=>row.kind==='turno' && row.date===date && row.period===c.period))) throw new Error('Esa fecha y turno ya tienen un histórico de Excel. Abre un turno nuevo para la operación actual.');
    const previous = s.shifts.at(-1);
    if (previous && (date < previous.date || (date === previous.date && (previous.period === 'Tarde' || c.period === 'Mañana')))) throw new Error('El turno debe ser posterior al último cierre.');
    const initial = c.openings as Record<string, unknown> | undefined;
    const team=c.responsibles===undefined?undefined:waiterNames(c.responsibles,c.period==='Tarde'?2:1);
    s.shifts.push({ id: uid(), date, period: c.period, responsible: team?.[0]??required(c.responsible, 'Responsable'), ...(team?{responsibles:team}:{}), status: 'open', openedAt: new Date().toISOString(), rows: s.products.filter(p=>!isKitchenProduct(p)&&(p.active!==false||reserveQuantity(s,p.id)>0||(previous?.rows.find(r=>r.productId===p.id)?.closing??0)>0)).map(p => ({ productId: p.id, opening: previous ? previous.rows.find(r => r.productId === p.id)?.closing ?? 0 : integer(initial?.[p.id] ?? 0, 'Conteo inicial'), incoming: 0, waste: 0, closing: null })) });
  } else if(c.type==='addWaiters'){
    if(!active)throw new Error('No hay un turno abierto.');
    const added=waiterNames(c.names);
    const team=shiftTeam(active);
    if(added.some(name=>team.includes(name)))throw new Error('Ese mozo ya forma parte del turno.');
    if(team.length+added.length>4)throw new Error('Un turno admite como máximo 4 mozos.');
    active.responsibles=[...team,...added];
  } else if(c.type==='replaceWaiter'){
    if(!active||c.shiftId!==active.id)throw new Error('Solo puedes cambiar mozos del turno abierto.');
    const team=shiftTeam(active),outgoing=required(c.outgoing,'Mozo a reemplazar');
    const replacement=waiterNames([c.replacement])[0];
    required(c.reason,'Motivo del cambio');
    const index=team.indexOf(outgoing);
    if(index<0)throw new Error('El mozo a reemplazar ya no pertenece a este turno. Actualiza los datos.');
    if(outgoing===replacement)throw new Error('Selecciona un mozo distinto como reemplazo.');
    if(team.includes(replacement))throw new Error('El reemplazo ya forma parte del turno.');
    team[index]=replacement;
    active.responsibles=waiterNames(team,active.period==='Tarde'?2:1);
    active.responsible=active.responsibles[0];
  } else if (c.type === 'produce') {
    if (!product) throw new Error('Producto inválido.');
    if(product.active===false)throw new Error('El producto está desactivado para nueva producción.');
    const quantity = integer(c.quantity, 'Cantidad', 1);
    const responsible = required(c.responsible, 'Responsable');
    if (active && shiftTeam(active).some(name=>personKey(responsible)===personKey(name))) throw new Error('El cocinero responsable debe ser distinto del responsable del mostrador.');
    const date = required(c.date, 'Fecha de producción');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > limaDate()) throw new Error('Fecha de producción inválida o futura.');
    const note = typeof c.note === 'string' ? c.note.slice(0, 180) : '';
    s.lots.push({ id: uid(), productId: product.id, quantity, producedQuantity:quantity, producedAt: date, note, yield: 1, responsible });
    log('Producción', quantity, note, responsible);
    s.movements[0].lotId=s.lots.at(-1)!.id;
  } else if(c.type==='adjustReserve'){
    if(!product)throw new Error('Selecciona un producto válido.');
    const quantity=integer(c.quantity,'Total correcto');
    const responsible=required(c.responsible,'Cocinero responsable');
    const reason=required(c.reason,'Motivo del ajuste');
    const lots=s.lots.filter(l=>l.productId===product.id).sort((a,b)=>a.producedAt.localeCompare(b.producedAt));
    const previous=lots.reduce((sum,l)=>sum+l.quantity,0);
    const delta=quantity-previous;
    if(!delta)throw new Error('No hay cambios para guardar.');
    const note=`Ajuste de reserva: ${previous} → ${quantity}. Motivo: ${reason}`;
    const record=(lot:Lot,change:number)=>{
      // Freeze the declared production of legacy lots before changing their balance.
      lot.producedQuantity??=lot.quantity+s.movements.filter(m=>m.lotId===lot.id&&['Retiro de producción','Horneado','Horneado en cocina','Corrección de ingreso'].includes(m.type)).reduce((n,m)=>n+m.quantity,0)-s.movements.filter(m=>m.lotId===lot.id&&m.type==='Ajuste de reserva').reduce((n,m)=>n+m.quantity,0);
      lot.quantity+=change;
      s.movements.unshift({id:uid(),at:new Date().toISOString(),productId:product.id,lotId:lot.id,type:'Ajuste de reserva',quantity:change,note,responsible});
    };
    if(delta<0){
      let remaining=-delta;
      for(const lot of lots){const change=Math.min(remaining,lot.quantity);if(change){record(lot,-change);remaining-=change;}if(!remaining)break;}
    }else{
      let lot=lots.at(-1);
      if(!lot){lot={id:uid(),productId:product.id,quantity:0,producedQuantity:0,producedAt:limaDate(),note:'Conteo inicial por ajuste',yield:1,responsible};s.lots.push(lot);}
      record(lot,delta);
    }
  } else if(c.type==='correctLotDate'){
    const lot=s.lots.find(l=>l.id===c.lotId);
    if(!lot)throw new Error('Selecciona un lote válido.');
    if(c.expectedDate!==lot.producedAt)throw new Error('Los datos cambiaron en este lote. Actualiza y vuelve a abrir el formulario.');
    const date=required(c.date,'Fecha de producción');
    if(date<'0001-01-01'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>limaDate())throw new Error('Fecha de producción inválida o futura.');
    if(date===lot.producedAt)throw new Error('No hay cambios para guardar.');
    const responsible=required(c.responsible,'Cocinero responsable');
    const reason=required(c.reason,'Motivo de la corrección');
    s.lotDateCorrections??=[];
    s.lotDateCorrections.unshift({id:uid(),lotId:lot.id,productId:lot.productId,previousDate:lot.producedAt,date,responsible,reason,at:new Date().toISOString()});
    lot.producedAt=date;
  } else if(c.type==='correctProduction'){
    const lot=s.lots.find(item=>item.id===c.lotId);
    if(!lot)throw new Error('Selecciona un registro de producción válido.');
    const quantity=integer(c.quantity,'Cantidad producida corregida');
    const responsible=required(c.responsible,'Cocinero responsable');
    const reason=required(c.reason,'Motivo de la corrección');
    const withdrawn=s.movements.filter(m=>m.lotId===lot.id&&['Retiro de producción','Horneado','Horneado en cocina','Corrección de ingreso'].includes(m.type)).reduce((sum,m)=>sum+m.quantity,0);
    const adjustments=s.movements.filter(m=>m.lotId===lot.id&&m.type==='Ajuste de reserva').reduce((sum,m)=>sum+m.quantity,0);
    const produced=lot.producedQuantity??lot.quantity+withdrawn-adjustments;
    const consumed=produced-lot.quantity;
    if(quantity<consumed)throw new Error(`La producción no puede ser menor que las ${consumed} unidades que ya salieron de reserva.`);
    const delta=quantity-produced;
    if(!delta)throw new Error('No hay cambios para guardar.');
    if(lot.quantity+delta>100000)throw new Error('La reserva corregida supera el límite permitido.');
    lot.producedQuantity=quantity;lot.quantity+=delta;
    const previous=s.movements.find(m=>m.lotId===lot.id&&m.type==='Producción');
    s.movements.unshift({id:uid(),at:new Date().toISOString(),productId:lot.productId,type:'Corrección de producción',quantity:delta,lotId:lot.id,responsible,note:`Corrección de producción: ${produced} → ${quantity}. Motivo: ${reason}`,...(previous?.shiftId?{shiftId:previous.shiftId}:{})});
  } else if (c.type === 'replenish') {
    if (!active || !product) throw new Error('Necesitas un turno abierto y un producto válido.');
    const quantity = integer(c.quantity, 'Unidades congeladas', 1);
    if (c.output !== undefined && c.output !== quantity) throw new Error('Ahora se cuenta por unidades: la cantidad que ingresa al mostrador debe ser igual a la retirada de producción.');
    if(isKitchenProduct(product))throw new Error('Este producto se utiliza en platos desde Horneados; no ingresa al mostrador.');
    const baked=product.category==='Bollería';
    const lot=baked?(s.baked??[]).find(l=>l.lotId===c.lotId&&l.productId===product.id):s.lots.find(l=>l.id===c.lotId&&l.productId===product.id);
    const oldest=baked?oldestBakedLot(s,product.id)?.lotId:oldestAvailableLot(s.lots,product.id)?.id;
    if(lot&&c.lotId!==oldest)throw new Error('Debes ingresar primero el lote más antiguo con stock de este producto.');
    if(!lot||lot.quantity<quantity)throw new Error(baked?'No hay suficientes unidades horneadas.':'El lote no tiene suficiente stock congelado.');
    const row=active.rows.find(r=>r.productId===product.id);
    if(!row||row.incoming+quantity>100000||available(row)+quantity>100000)throw new Error('El ingreso supera el límite permitido en el mostrador.');
    lot.quantity-=quantity;row.incoming+=quantity;
    log(baked?'Ingreso de horneados':'Retiro de producción',quantity,`${quantity} unidades retiradas de ${baked?'horneados':'producción'} del lote ${String(c.lotId).slice(0,8)} e ingresadas al mostrador.`,required(c.responsible??active.responsible,'Mozo responsable'));
    s.movements[0].lotId=String(c.lotId);
    if(baked)s.movements[0].source='horneados';
    s.movements[0].responsibles=shiftTeam(active);
  } else if (c.type === 'correctShift') {
    const index = s.shifts.findIndex(shift => shift.id === c.shiftId);
    const shift = s.shifts[index];
    if (!shift || !product) throw new Error('Selecciona un turno y producto válidos.');
    if (s.shifts.slice(index + 1).some(next => next.status === 'closed')) throw new Error('Solo puedes corregir el turno abierto o el último cierre.');
    const row = shift.rows.find(r => r.productId === product.id);
    if (!row||isKitchenProduct(product)) throw new Error('El producto no pertenece al control de mostrador.');
    const responsible = required(c.responsible, 'Mozo responsable');
    const reason = required(c.reason, 'Motivo de la corrección');
    const incoming = integer(c.incoming, 'Ingreso corregido');
    const closing = shift.status === 'closed' ? integer(c.closing, 'Cierre corregido') : null;
    const delta = incoming - row.incoming;
    if (!delta && closing === row.closing) throw new Error('No hay cambios para guardar.');
    if (row.opening + incoming - row.waste < 0 || row.opening + incoming - row.waste > 100000 || (closing !== null && closing > row.opening + incoming - row.waste)) throw new Error('El cierre no puede superar el stock disponible ni producir ventas negativas.');
    const note = `Corrección: ingreso ${row.incoming} → ${incoming}; cierre ${row.closing ?? 'pendiente'} → ${closing ?? 'pendiente'}. Motivo: ${reason}`;
    if (delta) {
      const baked=product.category==='Bollería';
      const logs=s.movements.filter(m=>m.shiftId===shift.id&&m.productId===product.id&&m.lotId&&['Retiro de producción','Horneado','Ingreso de horneados','Corrección de ingreso'].includes(m.type));
      const allocations=delta>0?(baked?(s.baked??[]).filter(l=>l.productId===product.id&&l.quantity>0).sort((a,b)=>a.bakedAt.localeCompare(b.bakedAt)).map(l=>({lotId:l.lotId,source:'horneados' as const,quantity:l.quantity})):s.lots.filter(l=>l.productId===product.id&&l.quantity>0).sort((a,b)=>a.producedAt.localeCompare(b.producedAt)).map(l=>({lotId:l.id,source:undefined,quantity:l.quantity}))):Array.from(new Set(logs.map(m=>`${m.source??'congelador'}:${m.lotId}`))).map(key=>{const matching=logs.filter(m=>`${m.source??'congelador'}:${m.lotId}`===key);return {lotId:matching[0].lotId!,source:matching[0].source,quantity:matching.reduce((n,m)=>n+m.quantity,0)};});
      if(delta<0){
        // Undo FIFO by lot age, independently of movement insertion/read order.
        // Equal frozen dates retain registration order; baked ties match oldestBakedLot.
        const returnOrder=new Map([
          ...s.lots.toSorted((a,b)=>a.producedAt.localeCompare(b.producedAt)).map((l,index)=>[`congelador:${l.id}`,index] as const),
          ...(s.baked??[]).toSorted((a,b)=>a.bakedAt.localeCompare(b.bakedAt)||a.lotId.localeCompare(b.lotId)).map((l,index)=>[`horneados:${l.lotId}`,index] as const),
        ]);
        allocations.sort((a,b)=>(returnOrder.get(`${b.source??'congelador'}:${b.lotId}`)??-1)-(returnOrder.get(`${a.source??'congelador'}:${a.lotId}`)??-1));
      }
      let remaining=Math.abs(delta);
      for(const lot of allocations){
        if(c.lotId!==undefined&&lot.lotId!==c.lotId)continue;
        const quantity=Math.min(remaining,Math.max(0,lot.quantity));if(!quantity)continue;
        const change=delta>0?-quantity:quantity;
        if(lot.source==='horneados')changeBaked(s,product.id,lot.lotId,change);
        else{const frozen=s.lots.find(l=>l.id===lot.lotId)!;if(frozen.quantity+change>100000)throw new Error('La reserva corregida supera el límite permitido.');frozen.quantity+=change;}
        s.movements.unshift({id:uid(),at:new Date().toISOString(),productId:product.id,type:'Corrección de ingreso',quantity:delta>0?quantity:-quantity,note,responsible,responsibles:shiftTeam(shift),shiftId:shift.id,lotId:lot.lotId,...(lot.source?{source:lot.source}:{})});
        remaining-=quantity;if(!remaining)break;
      }
      if(remaining)throw new Error(delta>0?'No hay stock suficiente en reserva.':'No puedes devolver al lote más unidades de las retiradas en este turno.');
    }
    row.incoming = incoming; row.closing = closing;
    const nextRow = s.shifts[index + 1]?.rows.find(r => r.productId === product.id);
    if (nextRow && closing !== null) {
      if (closing + nextRow.incoming - nextRow.waste > 100000) throw new Error('La entrada corregida supera el límite del siguiente turno.');
      nextRow.opening = closing;
    }
    if(!delta)s.movements.unshift({id:uid(),at:new Date().toISOString(),productId:product.id,type:'Corrección de cierre',quantity:0,note,responsible,responsibles:shiftTeam(shift),shiftId:shift.id});
  } else if (c.type === 'close') {
    if (!active) throw new Error('No hay un turno abierto.');
    const counts = c.counts as Record<string, unknown> | undefined;
    for (const row of active.rows) {
      const kitchen=isKitchenProduct(s.products.find(p=>p.id===row.productId)!);
      if(kitchen&&available(row)!==0)throw new Error('Hay existencias anteriores de Cocina que requieren revisión.');
      const count = kitchen?0:integer(counts?.[row.productId], 'Conteo de cierre');
      if (count > available(row)) throw new Error(`El cierre de ${s.products.find(p => p.id === row.productId)?.name} supera el stock disponible. Revisa los ingresos.`);
      row.closing = count;
    }
    active.status = 'closed'; active.closedAt = new Date().toISOString();
  } else if(c.type==='productStatus'){
    if(!product||typeof c.active!=='boolean')throw new Error('Estado de producto inválido.');
    product.active=c.active;
    if(c.active&&active&&!isKitchenProduct(product)&&!active.rows.some(r=>r.productId===product.id))active.rows.push({productId:product.id,opening:0,incoming:0,waste:0,closing:null});
  } else if(c.type==='productDelete'){
    const reason=productDeletionReason(s,String(c.productId));if(reason)throw new Error(reason);
    s.products=s.products.filter(p=>p.id!==c.productId);
    if(active)active.rows=active.rows.filter(r=>r.productId!==c.productId);
  } else if (c.type === 'createProduct') {
    const name = required(c.name, 'Nombre');
    if (s.products.some(p => p.name.toLocaleLowerCase('es-PE') === name.toLocaleLowerCase('es-PE'))) throw new Error('Ya existe un producto con ese nombre.');
    const category=normalizeCategory(c.category);
    if (!category) throw new Error('Categoría inválida.');
    if (c.yield !== undefined && c.yield !== 1) throw new Error('El inventario se controla por unidades, sin conversiones.');
    const added: Product = { id: uid(), name, category, yield: 1, minimum: integer(c.minimum, 'Mínimo') };
    s.products.push(added);
    if (c.reserveMinimum !== undefined) added.reserveMinimum = c.reserveMinimum === null ? null : integer(c.reserveMinimum, 'Mínimo en reserva');
    if (active&&!isKitchenProduct(added)) active.rows.push({ productId: added.id, opening: 0, incoming: 0, waste: 0, closing: null });
  } else if (c.type === 'product') {
    if (!product) throw new Error('Producto inválido.');
    product.name = required(c.name, 'Nombre');
    if (c.yield !== undefined && c.yield !== 1) throw new Error('El inventario se controla por unidades, sin conversiones.');
    product.yield = 1;
    product.minimum = integer(c.minimum, 'Mínimo');
    if (c.reserveMinimum !== undefined) product.reserveMinimum = c.reserveMinimum === null ? null : integer(c.reserveMinimum, 'Mínimo en reserva');
  } else throw new Error('Operación desconocida.');
  s.revision++;
  return s;
}
