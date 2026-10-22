import { initialSupplies, executeSupplyCommand, type Supply, type SupplyMovement } from './supplies';
import { executeExcelImport, type ExcelImport } from './excel-history';

export type Product = { id: string; name: string; category: 'Postres' | 'Viennoiserie'; yield: number; minimum: number; reserveMinimum?: number | null };
export type Lot = { id: string; productId: string; quantity: number; producedAt: string; note: string; yield?: number; responsible?: string };
export type Row = { productId: string; opening: number; incoming: number; waste: number; closing: number | null };
export type Shift = { id: string; date: string; period: 'Mañana' | 'Tarde'; responsible: string; status: 'open' | 'closed'; rows: Row[]; openedAt?: string; closedAt?: string };
export type Movement = { id: string; at: string; productId: string; type: string; quantity: number; note: string; responsible: string; shiftId?: string; lotId?: string };
export type State = { revision: number; products: Product[]; lots: Lot[]; shifts: Shift[]; movements: Movement[]; supplies?: Supply[]; supplyMovements?: SupplyMovement[]; excelImports?: ExcelImport[] };
export type Command = { type: string; revision: number; [key: string]: unknown };
export const limaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const uid = () => crypto.randomUUID();
export const available = (r: Row) => r.opening + r.incoming - r.waste;
export const sales = (r: Row) => r.closing === null ? null : available(r) - r.closing;
// Array order breaks ties by registration order (PostgreSQL reads lots by id).
export const oldestAvailableLot = (lots: Lot[], productId: string) => lots.filter(l => l.productId === productId && l.quantity > 0).sort((a,b) => a.producedAt.localeCompare(b.producedAt))[0];
export const personKey = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
export function seed(): State {
  const names = ['Sacher de Tumbo', 'Choux de Maracuya', 'Choux de Café', 'Tartaleta de Limón', 'Vainilla Cacao', 'Tiramisu', 'Tartaleta de Toffe', 'Pastel de Queso Japones', 'Delicia Multifloral', 'Ciudad Blanca', 'Amor Eterno', 'Charlotte de Lucuma', 'Flor Andina', 'Entremet', 'Kaori del Valle', 'Coco Mango', 'Pistacho Rose'];
  const products: Product[] = names.map((name, i) => ({ id: `p${i + 1}`, name, category: 'Postres', yield: 1, minimum: 1 }));
  products.push(...['Croissant clásico', 'Croissant de chocolate', 'Roll de canela', 'Croissant de almendras'].map((name, i): Product => ({ id: `v${i + 1}`, name, category: 'Viennoiserie', yield: 1, minimum: 1 })));
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
  if (c.type === 'excelImport') return executeExcelImport(original, c);
  if (typeof c.type === 'string' && c.type.startsWith('supply')) return executeSupplyCommand(original, c);
  if (c.revision !== original.revision) throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
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
    s.shifts.push({ id: uid(), date, period: c.period, responsible: required(c.responsible, 'Responsable'), status: 'open', openedAt: new Date().toISOString(), rows: s.products.map(p => ({ productId: p.id, opening: previous ? previous.rows.find(r => r.productId === p.id)?.closing ?? 0 : integer(initial?.[p.id] ?? 0, 'Conteo inicial'), incoming: 0, waste: 0, closing: null })) });
  } else if (c.type === 'produce') {
    if (!product) throw new Error('Producto inválido.');
    const quantity = integer(c.quantity, 'Cantidad', 1);
    const responsible = required(c.responsible, 'Responsable');
    if (active && personKey(responsible) === personKey(active.responsible)) throw new Error('El cocinero responsable debe ser distinto del responsable del mostrador.');
    const date = required(c.date, 'Fecha de producción');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > limaDate()) throw new Error('Fecha de producción inválida o futura.');
    const note = typeof c.note === 'string' ? c.note.slice(0, 180) : '';
    s.lots.push({ id: uid(), productId: product.id, quantity, producedAt: date, note, yield: 1, responsible });
    log('Producción', quantity, note, responsible);
  } else if (c.type === 'replenish') {
    if (!active || !product) throw new Error('Necesitas un turno abierto y un producto válido.');
    const quantity = integer(c.quantity, 'Unidades congeladas', 1);
    if (c.output !== undefined && c.output !== quantity) throw new Error('Ahora se cuenta por unidades: la cantidad que ingresa al mostrador debe ser igual a la retirada de producción.');
    const lot = s.lots.find(l => l.id === c.lotId && l.productId === product.id);
    if (lot && lot.id !== oldestAvailableLot(s.lots, product.id)?.id) throw new Error('Debes ingresar primero el lote más antiguo con stock de este producto.');
    if (!lot || lot.quantity < quantity) throw new Error('El lote no tiene suficiente stock congelado.');
    lot.quantity -= quantity;
    active.rows.find(r => r.productId === product.id)!.incoming += quantity;
    log(product.category === 'Postres' ? 'Retiro de producción' : 'Horneado', quantity, `${quantity} unidades retiradas de producción del lote ${lot.id.slice(0, 8)} e ingresadas al mostrador.`, required(c.responsible ?? active.responsible,'Mozo responsable'));
    s.movements[0].lotId = lot.id;
  } else if (c.type === 'correctShift') {
    const index = s.shifts.findIndex(shift => shift.id === c.shiftId);
    const shift = s.shifts[index];
    if (!shift || !product) throw new Error('Selecciona un turno y producto válidos.');
    if (s.shifts.slice(index + 1).some(next => next.status === 'closed')) throw new Error('Solo puedes corregir el turno abierto o el último cierre.');
    const row = shift.rows.find(r => r.productId === product.id);
    if (!row) throw new Error('El producto no pertenece a este turno.');
    const responsible = required(c.responsible, 'Mozo responsable');
    const reason = required(c.reason, 'Motivo de la corrección');
    const incoming = integer(c.incoming, 'Ingreso corregido');
    const closing = shift.status === 'closed' ? integer(c.closing, 'Cierre corregido') : null;
    const delta = incoming - row.incoming;
    if (!delta && closing === row.closing) throw new Error('No hay cambios para guardar.');
    if (row.opening + incoming - row.waste < 0 || row.opening + incoming - row.waste > 100000 || (closing !== null && closing > row.opening + incoming - row.waste)) throw new Error('El cierre no puede superar el stock disponible ni producir ventas negativas.');
    const note = `Corrección: ingreso ${row.incoming} → ${incoming}; cierre ${row.closing ?? 'pendiente'} → ${closing ?? 'pendiente'}. Motivo: ${reason}`;
    if (delta) {
      const lot = s.lots.find(l => l.id === c.lotId && l.productId === product.id);
      if (!lot || lot.quantity - delta < 0 || lot.quantity - delta > 100000) throw new Error('Selecciona un lote con stock suficiente.');
      const withdrawn = s.movements.filter(m => m.shiftId === shift.id && m.productId === product.id && m.lotId === lot.id && ['Retiro de producción','Horneado','Corrección de ingreso'].includes(m.type)).reduce((sum,m) => sum + m.quantity, 0);
      if (delta < 0 && -delta > withdrawn) throw new Error('No puedes devolver al lote más unidades de las retiradas en este turno.');
      lot.quantity -= delta;
    }
    row.incoming = incoming; row.closing = closing;
    const nextRow = s.shifts[index + 1]?.rows.find(r => r.productId === product.id);
    if (nextRow && closing !== null) {
      if (closing + nextRow.incoming - nextRow.waste > 100000) throw new Error('La entrada corregida supera el límite del siguiente turno.');
      nextRow.opening = closing;
    }
    s.movements.unshift({id:uid(),at:new Date().toISOString(),productId:product.id,type:delta ? 'Corrección de ingreso' : 'Corrección de cierre',quantity:delta,note,responsible,shiftId:shift.id,...(delta ? {lotId:String(c.lotId)} : {})});
  } else if (c.type === 'close') {
    if (!active) throw new Error('No hay un turno abierto.');
    const counts = c.counts as Record<string, unknown> | undefined;
    for (const row of active.rows) {
      const count = integer(counts?.[row.productId], 'Conteo de cierre');
      if (count > available(row)) throw new Error(`El cierre de ${s.products.find(p => p.id === row.productId)?.name} supera el stock disponible. Revisa los ingresos.`);
      row.closing = count;
    }
    active.status = 'closed'; active.closedAt = new Date().toISOString();
  } else if (c.type === 'createProduct') {
    const name = required(c.name, 'Nombre');
    if (s.products.some(p => p.name.toLocaleLowerCase('es-PE') === name.toLocaleLowerCase('es-PE'))) throw new Error('Ya existe un producto con ese nombre.');
    if (c.category !== 'Postres' && c.category !== 'Viennoiserie') throw new Error('Categoría inválida.');
    if (c.yield !== undefined && c.yield !== 1) throw new Error('El inventario se controla por unidades, sin conversiones.');
    const added: Product = { id: uid(), name, category: c.category, yield: 1, minimum: integer(c.minimum, 'Mínimo') };
    s.products.push(added);
    if (c.reserveMinimum !== undefined) added.reserveMinimum = c.reserveMinimum === null ? null : integer(c.reserveMinimum, 'Mínimo en reserva');
    if (active) active.rows.push({ productId: added.id, opening: 0, incoming: 0, waste: 0, closing: null });
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
