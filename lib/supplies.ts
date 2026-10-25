import type { Command, State } from './inventory';
import {supplyDeletionReason} from './catalog';

export const SUPPLY_GROUPS = ['Frutas congeladas', 'Insumos', 'Bebidas', 'Empaques', 'Preparados líquidos', 'Limpieza', 'Cocina'] as const;
export const SUPPLY_UNITS = ['porcion', 'bolsa', 'caja', 'botella', 'unidad', 'paquete', 'ml', 'sobre'] as const;
export type SupplyGroup = typeof SUPPLY_GROUPS[number];
export type SupplyUnit = typeof SUPPLY_UNITS[number];
export type Supply = { active?:boolean; mergedInto?:string; id: string; name: string; group: SupplyGroup; unit: SupplyUnit; minimum: number | null; stock: number | null; capacityMl: number | null; packSize: number; note: string; estimated: boolean };
export type SupplyMovement = { id: string; supplyId: string; action: 'entrada' | 'salida' | 'conteo'; quantity: number; before: number | null; after: number; responsible: string; note: string; estimated: boolean; at: string };
export const unitLabel = (unit: SupplyUnit) => ({ porcion: 'porciones', bolsa: 'bolsas', caja: 'cajas', botella: 'botellas', unidad: 'unidades', paquete: 'paquetes', ml: 'ml', sobre:'sobres' })[unit];
export function initialSupplies(): Supply[] {
  const items: Supply[] = [];
  const add = (code: string, name: string, group: SupplyGroup, unit: SupplyUnit, capacityMl: number | null = null, packSize = 1, note = '') => items.push({ id: code, name, group, unit, capacityMl, packSize, note, minimum: null, stock: null, estimated: false });
  ['Frutos rojos', 'Mango', 'Piña', 'Papaya norteña', 'Papaya arequipeña', 'Fresa'].forEach((name, i) => add(`fruta-${i}`, name, 'Frutas congeladas', 'porcion'));
  ['Café', 'Azúcar', 'Stevia', 'Matcha', 'Hielo'].forEach((name, i) => add(`insumo-${i}`, name, 'Insumos', i===1||i===2?'sobre':'bolsa',null,i===1?500:i===2?100:1,i===1?'Bolsa de 500 sobres de 5 g. Control por sobres.':i===2?'Bolsa de 100 sobres de 1 g. Control por sobres.':''));
  add('flores', 'Flores comestibles', 'Insumos', 'caja');
  ['Manzana', 'Naranja', 'Piña', 'Fresa'].forEach((name, i) => add(`deshidratada-${i}`, `${name} deshidratada`, 'Insumos', 'bolsa'));
  ['Bella Durmiente', 'Herbalito de eucalipto', 'Taza de Amor', 'Bombón como tú', 'Kuyay', 'Qori'].forEach((name, i) => add(`infusion-${i}`, `Infusión ${name}`, 'Insumos', 'bolsa', null, 1, 'Control por bolsas. Presentación interna pendiente de confirmar.'));
  add('leche-entera', 'Leche entera', 'Insumos', 'bolsa', 1125);
  add('leche-deslactosada', 'Leche deslactosada', 'Insumos', 'bolsa', 1125);
  add('agua-con-gas', 'Agua con gas · vidrio', 'Bebidas', 'botella', 355);
  add('agua-sin-gas', 'Agua sin gas · vidrio', 'Bebidas', 'botella', 355);
  add('kombuchas','Kombuchas','Bebidas','botella',355);
  add('kola', 'Kola Escocesa · plástico', 'Bebidas', 'botella', 500);
  add('cajas-pequenas', 'Cajas pequeñas', 'Empaques', 'unidad', null, 1000);
  add('cajas-grandes', 'Cajas grandes', 'Empaques', 'unidad', null, 1000);
  ['Maracuyá', 'Toffe', 'Extracto de tumbo', 'Jarabe de goma', 'Almíbar de muña', 'Leche condensada'].forEach((name, i) => add(`liquido-${i}`, name, 'Preparados líquidos', 'ml', i === 5 ? 200 : 600));
  return items;
}
export function supplyAlert(item: Supply, inclusive = false): 'sin conteo' | 'agotado' | 'bajo mínimo' | 'sin mínimo' | 'disponible' {
  if (item.stock === null) return 'sin conteo';
  if (item.stock === 0) return 'agotado';
  if (item.minimum === null) return 'sin mínimo';
  return (inclusive ? item.stock <= item.minimum : item.stock < item.minimum) ? 'bajo mínimo' : 'disponible';
}
export const lowSupplies = (items: Supply[], inclusive = false) => items.filter(item => item.active!==false&&['agotado', 'bajo mínimo'].includes(supplyAlert(item, inclusive)));

const whole = (value: unknown, label: string, min = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 1_000_000_000) throw new Error(`${label}: ingresa un número entero válido, mínimo ${min}.`);
  return value;
};
const text = (value: unknown, label: string, max = 180): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label} es obligatorio (máximo ${max} caracteres).`);
  return value.trim();
};
export function executeSupplyCommand(original: State, command: Command): State {
  if (original.revision !== command.revision) throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
  const s = structuredClone(original);
  s.supplies ??= initialSupplies(); s.supplyMovements ??= [];
  const item = s.supplies.find(x => x.id === command.supplyId);
  if (command.type === 'supplyCreate') {
    const group = command.group as SupplyGroup, unit = command.unit as SupplyUnit;
    if (!SUPPLY_GROUPS.includes(group) || !SUPPLY_UNITS.includes(unit)) throw new Error('Categoría o unidad inválida.');
    if (group === 'Frutas congeladas' && unit !== 'porcion') throw new Error('Las frutas congeladas se cuentan solo por porciones.');
    if (group === 'Preparados líquidos' && unit !== 'ml') throw new Error('Los preparados líquidos se controlan en ml.');
    const name = text(command.name, 'Nombre');
    if (s.supplies.some(x => x.group === group && x.name.toLocaleLowerCase('es-PE') === name.toLocaleLowerCase('es-PE'))) throw new Error('Ya existe ese insumo en la categoría.');
    const capacityMl = command.capacityMl == null ? null : whole(command.capacityMl, 'Capacidad', 1);
    if (unit === 'ml' && capacityMl === null) throw new Error('Indica la capacidad del recipiente en ml.');
    const packSize = command.packSize == null ? 1 : whole(command.packSize, 'Unidades por paquete', 1);
    if (packSize !== 1 && group !== 'Empaques' && !(group==='Insumos'&&unit==='sobre')) throw new Error('La presentación por paquete solo se admite para empaques y bolsas de sobres.');
    s.supplies.push({ id: crypto.randomUUID(), name, group, unit, stock: null, minimum: command.minimum == null ? null : whole(command.minimum, 'Mínimo'), capacityMl, packSize, note: typeof command.note === 'string' ? command.note.slice(0, 500) : '', estimated: false });
  } else if(command.type==='supplyStatus'){
    if(!item||typeof command.active!=='boolean')throw new Error('Estado de insumo inválido.');
    if(command.active&&item.mergedInto)throw new Error('Este producto ya fue unificado. Usa Kombuchas.');
    item.active=command.active;
  } else if(command.type==='supplyDelete'){
    const reason=supplyDeletionReason(s,String(command.supplyId));if(reason)throw new Error(reason);
    s.supplies=s.supplies.filter(i=>i.id!==command.supplyId);
  } else if (command.type === 'supplyUpdate') {
    if (!item) throw new Error('Insumo inválido.');
    item.minimum = command.minimum == null ? null : whole(command.minimum, 'Mínimo');
    item.name = text(command.name, 'Nombre');
    if (s.supplies.some(x => x.id !== item.id && x.group === item.group && x.name.toLowerCase() === item.name.toLowerCase())) throw new Error('Ya existe ese nombre en la categoría.');
    item.note = typeof command.note === 'string' ? command.note.slice(0, 500) : '';
  } else if (command.type === 'supplyMove') {
    if (!item) throw new Error('Insumo inválido.');

    const action = command.action as SupplyMovement['action'];
    if (!['entrada', 'salida', 'conteo'].includes(action)) throw new Error('Movimiento inválido.');
    const responsible = text(command.responsible, 'Responsable', 80);
    let quantity: number;
    let estimated = false;
    if (command.percent !== undefined) {
      if (item.unit !== 'ml' || !item.capacityMl || action !== 'conteo' || typeof command.percent !== 'number' || !Number.isFinite(command.percent) || command.percent < 0 || command.percent > 100) throw new Error('El porcentaje solo se usa para contar un recipiente líquido, entre 0 y 100.');
      quantity = Math.round(item.capacityMl * command.percent / 100); estimated = true;
    } else quantity = whole(command.quantity, 'Cantidad', action === 'conteo' ? 0 : 1);
    if (command.byPack === true) {
      if ((item.group !== 'Empaques'&&item.unit!=='sobre') || action !== 'entrada' || item.packSize<=1) throw new Error('La entrada por presentación requiere un empaque o una bolsa de sobres.');
      quantity = whole(quantity * item.packSize, 'Cantidad total', 1);
    }
    if (action !== 'conteo' && item.stock === null) throw new Error('Registra primero el conteo inicial de este insumo.');
    if(item.mergedInto)throw new Error('Este producto fue unificado. Registra el movimiento en Kombuchas.');
    if(item.active===false&&(action==='entrada'||action==='conteo'&&quantity>(item.stock??0)))throw new Error('El producto está desactivado para nuevos ingresos.');
    const before = item.stock;
    const after = action === 'conteo' ? quantity : action === 'entrada' ? before! + quantity : before! - quantity;
    if (after < 0) throw new Error('No hay suficiente stock para ese retiro.');
    whole(after, 'Stock resultante');
    if (item.unit === 'ml' && item.capacityMl !== null && after > item.capacityMl) throw new Error('El contenido supera la capacidad del recipiente.');
    let note = typeof command.note === 'string' ? command.note.trim().slice(0, 500) : '';
    if (action === 'conteo' && before !== null && !note) throw new Error('Indica el motivo del nuevo conteo.');
    if (action === 'conteo' && before === null && !note) note = 'Conteo inicial';
    item.stock = after;
    item.estimated = action === 'conteo' ? estimated : item.estimated;
    s.supplyMovements.unshift({ id: crypto.randomUUID(), supplyId: item.id, action, quantity, before, after, responsible, note, estimated: item.estimated, at: new Date().toISOString() });
  } else throw new Error('Operación de insumos desconocida.');
  s.revision++;
  return s;
}

/** Validates supply data when restoring an untrusted beta backup. */
export function validateSupplyBackup(items: unknown, movements: unknown): { supplies: Supply[]; supplyMovements: SupplyMovement[] } {
  if (!Array.isArray(items) || !Array.isArray(movements) || items.length > 2000 || movements.length > 100000) throw new Error('El respaldo de insumos no es válido.');
  const ids = new Set<string>();
  const supplies = items.map((value: Supply) => {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || ids.has(value.id) || !SUPPLY_GROUPS.includes(value.group) || !SUPPLY_UNITS.includes(value.unit)) throw new Error('El respaldo de insumos no es válido.');
    ids.add(value.id);
    const item: Supply = { id: value.id, name: text(value.name, 'Nombre'), group: value.group, unit: value.unit, minimum: value.minimum === null ? null : whole(value.minimum, 'Mínimo'), stock: value.stock === null ? null : whole(value.stock, 'Stock'), capacityMl: value.capacityMl === null ? null : whole(value.capacityMl, 'Capacidad', 1), packSize: whole(value.packSize, 'Presentación', 1), note: typeof value.note === 'string' ? value.note.slice(0, 500) : '', estimated: value.estimated === true };
    if(value.active!==undefined){if(typeof value.active!=='boolean')throw new Error('Estado de insumo inválido.');item.active=value.active;}
    if(value.mergedInto!==undefined){if(typeof value.mergedInto!=='string'||!value.mergedInto)throw new Error('Fusión inválida.');item.mergedInto=value.mergedInto;}
    if (item.group === 'Frutas congeladas' && item.unit !== 'porcion') throw new Error('Las frutas se cuentan por porciones.');
    if (item.unit === 'ml' && (!item.capacityMl || (item.stock !== null && item.stock > item.capacityMl))) throw new Error('Contenido líquido inválido.');
    return item;
  });
  for(const item of supplies){if(item.mergedInto&&(item.active!==false||item.mergedInto===item.id||!supplies.some(target=>target.id===item.mergedInto&&!target.mergedInto)))throw new Error('Unificación inválida.');}
  const movementIds = new Set<string>();
  const supplyMovements = movements.map((m: SupplyMovement) => {
    if (!m || typeof m.id !== 'string' || !m.id || movementIds.has(m.id) || !ids.has(m.supplyId) || !['entrada', 'salida', 'conteo'].includes(m.action) || typeof m.at !== 'string' || !Number.isFinite(Date.parse(m.at))) throw new Error('El historial de insumos no es válido.');
    movementIds.add(m.id);
    const result: SupplyMovement = { id: m.id, supplyId: m.supplyId, action: m.action, quantity: whole(m.quantity, 'Cantidad', m.action === 'conteo' ? 0 : 1), before: m.before === null ? null : whole(m.before, 'Stock anterior'), after: whole(m.after, 'Stock posterior'), responsible: text(m.responsible, 'Responsable', 80), note: typeof m.note === 'string' ? m.note.slice(0, 500) : '', estimated: m.estimated === true, at: m.at };
    if (result.action !== 'conteo' && result.before === null) throw new Error('Falta conteo inicial en el historial.');
    const expected = result.action === 'conteo' ? result.quantity : result.action === 'entrada' ? result.before! + result.quantity : result.before! - result.quantity;
    if (result.after !== expected) throw new Error('El saldo del movimiento no es válido.');
    return result;
  });
  for (const item of supplies) {
    const latest = supplyMovements.find(m => m.supplyId === item.id);
    if (latest && latest.after !== item.stock) throw new Error('El stock no coincide con el historial del respaldo.');
    if (item.stock !== null && !latest) throw new Error('Falta el historial del conteo inicial.');
  }
  return { supplies, supplyMovements };
}
