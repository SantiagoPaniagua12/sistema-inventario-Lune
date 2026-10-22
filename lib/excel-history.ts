import { limaDate, type Command, type Product, type Shift, type State } from './inventory';

export type ExcelRecord = { productId: string; date: string; sheet: string; row: number } & (
  { kind: 'turno'; period: 'Mañana' | 'Tarde'; opening: number; incoming: number; closing: number } |
  { kind: 'reserva'; period: 'Mañana' | 'Tarde'; opening: number; produced: number; used: number; quantity: number }
);
export type ExcelImport = { id: string; filename: string; importedBy: string; importedAt: string; records: ExcelRecord[] };
export const excelRecordKey = (row: ExcelRecord) => `${row.kind}|${row.date}|${row.period}|${row.productId}`;
export function validateExcelRecords(value: unknown, products: Product[]): ExcelRecord[] {
  if (!Array.isArray(value) || !value.length || value.length > 3000) throw new Error('Importa entre 1 y 3000 filas por vez.');
  const ids = new Set(products.filter(p => p.category === 'Postres').map(p => p.id));
  const keys = new Set<string>();
  const integer = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 100000) throw new Error('Las cantidades deben ser enteros entre 0 y 100000.');
    return n;
  };
  return value.map((v: unknown) => {
    if (!v || typeof v !== 'object') throw new Error('Fila de Excel inválida.');
    const r = v as Record<string, unknown>;
    if (typeof r.productId !== 'string' || !ids.has(r.productId)) throw new Error('El Excel solo puede asociarse a postres del catálogo.');
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(r.date)) || new Date(r.date).toISOString().slice(0,10) !== r.date || r.date > limaDate()) throw new Error('Revisa las fechas: no pueden ser inválidas ni futuras.');
    if (typeof r.sheet !== 'string' || !r.sheet.trim() || r.sheet.length > 100 || !Number.isSafeInteger(r.row) || Number(r.row) < 1 || Number(r.row) > 5000) throw new Error('La hoja o el número de fila no es válido.');
    const base = { productId: r.productId, date: r.date, sheet: r.sheet, row: Number(r.row) };
    let row: ExcelRecord;
    if (r.kind === 'reserva' && (r.period === 'Mañana' || r.period === 'Tarde')) {
      row = { ...base, kind: 'reserva', period:r.period, opening:integer(r.opening), produced:integer(r.produced), used:integer(r.used), quantity: integer(r.quantity) };
      if (row.quantity !== row.opening + row.produced - row.used) throw new Error(`Fila ${row.row}: el saldo de reserva no coincide con entrada + producción − usados.`);
    }
    else if (r.kind === 'turno' && (r.period === 'Mañana' || r.period === 'Tarde')) {
      row = { ...base, kind: 'turno', period: r.period, opening: integer(r.opening), incoming: integer(r.incoming), closing: integer(r.closing) };
      if (row.closing > row.opening + row.incoming) throw new Error(`Fila ${row.row}: el cierre supera la entrada más los ingresos.`);
    } else throw new Error('Tipo de registro o turno inválido.');
    const key = excelRecordKey(row);
    if (keys.has(key)) throw new Error(`Fila ${row.row}: el producto está repetido en la misma fecha y turno.`);
    keys.add(key);
    return row;
  });
}

export function excelConflicts(state: State, rows: ExcelRecord[]): string[] {
  const existing = new Set((state.excelImports ?? []).flatMap(batch => batch.records.map(excelRecordKey)));
  return rows.filter(row => existing.has(excelRecordKey(row)) || row.kind==='turno' && state.shifts.some(shift=>shift.date===row.date && shift.period===row.period)).map(row => `Fila ${row.row}: ya existe un registro para ${state.products.find(p=>p.id===row.productId)?.name}, ${row.date} (${row.period}).`);
}

export function executeExcelImport(original: State, command: Command): State {
  if (command.revision !== original.revision) throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
  const records = validateExcelRecords(command.records, original.products);
  const conflicts = excelConflicts(original, records);
  if (conflicts.length) throw new Error(`${conflicts[0]} No se reemplazó ningún registro.`);
  if (typeof command.filename !== 'string' || !command.filename.trim() || command.filename.length > 180 || !/\.xlsx$/i.test(command.filename)) throw new Error('Selecciona un archivo .xlsx válido.');
  if (typeof command.importedBy !== 'string' || !command.importedBy.trim() || command.importedBy.trim().length > 80) throw new Error('Indica quién está importando el archivo (máximo 80 caracteres).');
  const batch: ExcelImport = { id: crypto.randomUUID(), filename: command.filename, importedBy: command.importedBy.trim(), importedAt: new Date().toISOString(), records };
  return { ...structuredClone(original), revision: original.revision+1, excelImports: [...(original.excelImports ?? []), batch] };
}

export function validateExcelBackup(value: unknown, products: Product[]): ExcelImport[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Historial Excel inválido.');
  const ids = new Set<string>(), keys = new Set<string>();
  return value.map(v => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(v.id) || ids.has(v.id) || typeof v.filename !== 'string' || !v.filename.trim() || v.filename.length > 180 || typeof v.importedBy !== 'string' || !v.importedBy.trim() || v.importedBy.length > 80 || typeof v.importedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v.importedAt) || !Number.isFinite(Date.parse(v.importedAt))) throw new Error('Historial Excel inválido.');
    ids.add(v.id);
    const records = validateExcelRecords(v.records, products);
    for (const row of records) { const key=excelRecordKey(row); if(keys.has(key)) throw new Error('Historial Excel duplicado.'); keys.add(key); }
    return { id:v.id, filename:v.filename, importedBy:v.importedBy, importedAt:v.importedAt, records };
  });
}

/** Archival shifts are for consultation only; never used for handoff or live stock. */
export function allSalesShifts(state: State): Shift[] {
  const archive = new Map<string, Shift>();
  for (const batch of state.excelImports ?? []) for (const row of batch.records) {
    if (row.kind !== 'turno') continue;
    const id = `excel:${row.date}:${row.period}`;
    const shift = archive.get(id) ?? { id, date:row.date, period:row.period, responsible:'Histórico de Excel', status:'closed', closedAt:batch.importedAt, rows:[] };
    shift.rows.push({ productId:row.productId, opening:row.opening, incoming:row.incoming, closing:row.closing, waste:0 });
    archive.set(id,shift);
  }
  return [...state.shifts,...archive.values()].sort((a,b)=>a.date.localeCompare(b.date) || (a.period === b.period ? 0 : a.period === 'Mañana' ? -1 : 1));
}
