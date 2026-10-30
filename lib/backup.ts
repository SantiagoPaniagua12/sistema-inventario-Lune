import {isKitchenProduct} from './baking';
import { available, type State, type Product, type Shift } from './inventory';
import {normalizeCategory} from './catalog';
import { validateSupplyBackup } from './supplies';
import { validateExcelBackup, excelConflicts } from './excel-history';

/** Validate an untrusted backup before it can replace the local inventory. */
export function validateBackup(value: unknown): State {
  const fail = (): never => { throw new Error('El respaldo no tiene una estructura de inventario válida.'); };
  const record = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
  const text = (v: unknown, max = 500): string => typeof v === 'string' && v.length <= max ? v : fail();
  const id = (v: unknown): string => { const s = text(v, 100); return s.trim() ? s : fail(); };
  const name = (v: unknown): string => { const s = text(v, 180); return s.trim() ? s : fail(); };
  const number = (v: unknown, min = 0): number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= 100000 ? v : fail();
  const date = (v: unknown): string => {
    const s = text(v, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : fail();
  };
  const timestamp = (v: unknown): string => {
    const s = text(v, 40);
    return !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : fail();
  };
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) fail(); };
  const team=(value:unknown):string[]=>{
    const names=list(value,4).map(value=>name(value));
    if(!names.length)fail();unique(names);return names;
  };

  const root = record(value);
  number(root.revision);
  const products = list(root.products, 1000).map(value => {
    const p = record(value);
    const category = normalizeCategory(p.category);
    if (category !== 'Postres' && category !== 'Bollería') fail();
    const yieldValue = number(p.yield, 1);
    if (category === 'Bollería' && yieldValue !== 1) fail();
    return { id: id(p.id), name: name(p.name), category:category!, yield: yieldValue, minimum: number(p.minimum), ...(p.kitchenOnly===undefined?{}:{kitchenOnly:typeof p.kitchenOnly==='boolean'?p.kitchenOnly:fail()}), ...(p.active===undefined?{}:{active:typeof p.active==='boolean'?p.active:fail()}), ...(p.reserveMinimum === undefined ? {} : { reserveMinimum:p.reserveMinimum === null ? null : number(p.reserveMinimum) }) };
  });
  if (!products.length) fail();
  unique(products.map(p => p.id));
  const names = products.map(p => p.name.toLocaleLowerCase('es-PE'));
  unique(names);
  const productIds = new Set(products.map(p => p.id));
  const lots = list(root.lots, 10000).map(value => {
    const l = record(value);
    const productId = id(l.productId);
    if (!productIds.has(productId)) fail();
    const producedQuantity=l.producedQuantity===undefined?undefined:number(l.producedQuantity);
    return { id: id(l.id), productId, quantity: number(l.quantity), producedAt: date(l.producedAt), note: text(l.note, 180), ...(l.yield === undefined ? {} : { yield: number(l.yield, 1) }), ...(l.responsible === undefined ? {} : { responsible: name(l.responsible) }),...(producedQuantity===undefined?{}:{producedQuantity}) };
  });
  unique(lots.map(l => l.id));
  const shifts = list(root.shifts, 10000).map(value => {
    const s = record(value);
    if (s.period !== 'Mañana' && s.period !== 'Tarde') fail();
    if (s.status !== 'open' && s.status !== 'closed') fail();
    const rows = list(s.rows, products.length).map(value => {
      const r = record(value);
      const productId = id(r.productId);
      if (!productIds.has(productId)) fail();
      const row = { productId, opening: number(r.opening), incoming: number(r.incoming), waste: number(r.waste), closing: r.closing === null ? null : number(r.closing) };
      if (available(row) < 0 || (row.closing !== null && row.closing > available(row))) fail();
      return row;
    });
    unique(rows.map(r => r.productId));
    if (s.status === 'closed' && rows.some(r => r.closing === null)) fail();
    if (s.status === 'open' && (products.some(p=>p.active!==false&&!isKitchenProduct(p)&&!rows.some(r=>r.productId===p.id)) || rows.some(r => r.closing !== null))) fail();
    const shift: Shift = { id: id(s.id), date: date(s.date), period: s.period as Shift['period'], responsible: name(s.responsible), status: s.status as Shift['status'], rows,
      ...(s.responsibles===undefined?{}:{responsibles:team(s.responsibles)}),
      ...(s.openedAt === undefined ? {} : { openedAt: timestamp(s.openedAt) }),
      ...(s.closedAt === undefined ? {} : { closedAt: timestamp(s.closedAt) }) };
    if (shift.status === 'closed' && !shift.closedAt) fail();
    if(shift.responsibles&&shift.responsibles[0]!==shift.responsible)fail();
    return shift;
  });
  unique(shifts.map(s => s.id));
  if (shifts.slice(0, -1).some(s => s.status === 'open')) fail();
  const shiftIds = new Set(shifts.map(s => s.id));
  const movements = list(root.movements, 20000).map(value => {
    const m = record(value);
    const productId = id(m.productId);
    if (!productIds.has(productId)) fail();
    const shiftId = m.shiftId === undefined ? undefined : id(m.shiftId);
    if (shiftId && !shiftIds.has(shiftId)) fail();
    const lotId = m.lotId === undefined ? undefined : id(m.lotId);
    if (lotId && !lots.some(l=>l.id===lotId && l.productId===productId)) fail();
    return { id: id(m.id), at: timestamp(m.at), productId, type: id(m.type), quantity: number(m.quantity, ['Corrección de ingreso','Corrección de producción','Ajuste de reserva'].includes(String(m.type)) ? -100000 : m.type==='Corrección de cierre' ? 0 : 1), note: text(m.note), responsible: name(m.responsible), ...(m.source===undefined?{}:{source:m.source==='horneados'?'horneados' as const:fail()}), ...(m.serviceDate===undefined?{}:{serviceDate:date(m.serviceDate),period:m.period==='Mañana'||m.period==='Tarde'?m.period as 'Mañana'|'Tarde':fail()}), ...(m.responsibles===undefined?{}:{responsibles:team(m.responsibles)}), ...(shiftId ? { shiftId } : {}), ...(lotId ? {lotId} : {}) };
  });
  unique(movements.map(m => m.id));
  for(const lot of lots){
    const adjustment=movements.filter(m=>m.lotId===lot.id&&m.type==='Ajuste de reserva').reduce((n,m)=>n+m.quantity,0);
    if(lot.producedQuantity!==undefined&&lot.quantity>lot.producedQuantity+adjustment)fail();
  }
  const extra: Pick<State,'supplies'|'supplyMovements'> = root.supplies === undefined && root.supplyMovements === undefined ? {} : validateSupplyBackup(root.supplies, root.supplyMovements);
  if(extra.supplyMovements?.some(m=>m.shiftId&&!shiftIds.has(m.shiftId)))fail();
  const state: State = { revision: number(root.revision), products, lots, shifts, movements, ...extra };
  if(root.lotDateCorrections!==undefined){
    state.lotDateCorrections=list(root.lotDateCorrections,20000).map(value=>{
      const c=record(value),lotId=id(c.lotId),productId=id(c.productId);
      if(!lots.some(l=>l.id===lotId&&l.productId===productId))fail();
      const previousDate=date(c.previousDate),correctedDate=date(c.date),reason=name(c.reason);
      if(previousDate===correctedDate)fail();
      return {id:id(c.id),lotId,productId,previousDate,date:correctedDate,responsible:name(c.responsible),reason,at:timestamp(c.at)};
    });
    unique(state.lotDateCorrections.map(c=>c.id));
    const latestDates=new Map<string,string>();
    for(const c of state.lotDateCorrections.toReversed()){
      if(latestDates.has(c.lotId)&&latestDates.get(c.lotId)!==c.previousDate)fail();
      latestDates.set(c.lotId,c.date);
    }
    for(const [lotId,correctedDate] of latestDates)if(lots.find(l=>l.id===lotId)?.producedAt!==correctedDate)fail();
  }
  if(root.baked!==undefined){
    state.baked=list(root.baked,10000).map(value=>{const b=record(value),productId=id(b.productId),lotId=id(b.lotId);
      if(!products.some(p=>p.id===productId&&p.category==='Bollería')||!lots.some(l=>l.id===lotId&&l.productId===productId))fail();
      const expected=movements.filter(m=>m.productId===productId&&m.lotId===lotId).reduce((n,m)=>n+(m.type==='Horneado en cocina'?m.quantity:m.type==='Uso en platos'||m.source==='horneados'?-m.quantity:0),0);
      if(number(b.quantity)!==expected)fail();
      return {productId,lotId,quantity:number(b.quantity),bakedAt:timestamp(b.bakedAt)};
    });
    unique(state.baked.map(l=>l.lotId));
    if(movements.some(m=>['Horneado en cocina','Uso en platos'].includes(m.type)&&!state.baked!.some(l=>l.lotId===m.lotId&&l.productId===m.productId)))fail();
  }else if(movements.some(m=>['Horneado en cocina','Uso en platos'].includes(m.type)))fail();
  if (root.excelImports !== undefined) {
    const batches = validateExcelBackup(root.excelImports, products);
    if (excelConflicts(state,batches.flatMap(batch=>batch.records)).length) fail();
    state.excelImports=batches;
  }
  return state;
}
