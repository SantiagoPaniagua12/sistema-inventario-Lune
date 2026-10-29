import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, seed, sales, limaDate, oldestAvailableLot, type State } from '../lib/inventory';
import { validateBackup } from '../lib/backup';
const date = limaDate();
function run(s: State, type: string, data: Record<string, unknown> = {}) { return execute(s, { type, revision: s.revision, ...data }); }
function open() { return run(seed(), 'open', { date, period: 'Mañana', responsible: 'Ana', openings: { p1: 5 } }); }

test('ingreso usa el lote más antiguo con stock, desempata por registro y avanza al agotarlo',()=>{
  for(const productId of ['p1']){
    let s=open();
    const yesterday=new Date(Date.parse(`${date}T12:00:00Z`)-86400000).toISOString().slice(0,10);
    s=run(s,'produce',{productId,quantity:5,responsible:'Joel',date});
    const newer=s.lots[0].id;
    s=run(s,'produce',{productId,quantity:2,responsible:'Joel',date:yesterday});
    const oldest=s.lots[1].id;
    s=run(s,'produce',{productId,quantity:1,responsible:'Joel',date:yesterday});
    const tied=s.lots[2].id;
    assert.equal(oldestAvailableLot(s.lots,productId)?.id,oldest);
    assert.throws(()=>run(s,'replenish',{productId,lotId:newer,quantity:1}),/más antiguo/);
    assert.throws(()=>run(s,'replenish',{productId,lotId:tied,quantity:1}),/más antiguo/);
    assert.throws(()=>run(s,'replenish',{productId,lotId:oldest,quantity:3}),/suficiente stock/);
    s=run(s,'replenish',{productId,lotId:oldest,quantity:2});
    assert.equal(oldestAvailableLot(s.lots,productId)?.id,tied);
    s=run(s,'replenish',{productId,lotId:tied,quantity:1});
    assert.equal(oldestAvailableLot(s.lots,productId)?.id,newer);
    s=run(s,'replenish',{productId,lotId:newer,quantity:5});
    assert.equal(oldestAvailableLot(s.lots,productId),undefined);
    assert.equal(s.shifts[0].rows.find(r=>r.productId===productId)!.incoming,8);
  }
});

test('correcciones conservan reserva, trazabilidad, cierres y entrada del siguiente turno',()=>{
  let s=run(open(),'produce',{productId:'p1',quantity:20,responsible:'Joel',date});
  const lotId=s.lots[0].id;
  s=run(s,'replenish',{productId:'p1',lotId,quantity:12});
  const shiftId=s.shifts[0].id;
  const correction={shiftId,productId:'p1',lotId,incoming:10,responsible:'Karla',reason:'Se digitó una cantidad incorrecta'};
  s=run(s,'correctShift',correction);
  assert.equal(s.lots[0].quantity,10);
  assert.equal(s.shifts[0].rows[0].incoming,10);
  assert.equal(s.movements[0].quantity,-2);
  assert.equal(s.movements[0].responsible,'Karla');
  s=run(s,'close',{counts:Object.fromEntries(s.products.map(p=>[p.id,p.id==='p1'?4:0]))});
  s=run(s,'open',{date,period:'Tarde',responsible:'Shalu'});
  s=run(s,'correctShift',{...correction,closing:3});
  assert.equal(s.shifts[1].rows[0].opening,3);
  assert.equal(sales(s.shifts[0].rows[0]),12);
  assert.deepEqual(validateBackup(s),s);
  assert.throws(()=>run(s,'correctShift',{...correction,closing:99}),/superar/);
  assert.throws(()=>run(s,'correctShift',{...correction,closing:3,reason:''}),/Motivo/);
  const other=run(s,'produce',{productId:'p1',quantity:10,responsible:'Joel',date});
  assert.throws(()=>run(other,'correctShift',{...correction,incoming:0,closing:3,lotId:other.lots.at(-1)!.id}),/más unidades/);
  assert.throws(()=>run(s,'correctShift',{...correction,incoming:100,closing:3}),/stock suficiente/);
  assert.throws(()=>execute(s,{...correction,type:'correctShift',revision:s.revision-1}),/datos cambiaron/);
  s=run(s,'close',{counts:Object.fromEntries(s.products.map(p=>[p.id,0]))});
  assert.throws(()=>run(s,'correctShift',{...correction,closing:2}),/último cierre/);
});
test('producción y retiro por unidades conservan cantidades y calculan la venta del turno', () => {
  let s = open();
  s = run(s, 'produce', { productId: 'p1', quantity: 20, responsible: 'Cocina', date });
  s = run(s, 'replenish', { productId: 'p1', lotId: s.lots[0].id, quantity: 12 });
  const counts = Object.fromEntries(s.products.map(p => [p.id, p.id === 'p1' ? 4 : 0]));
  s = run(s, 'close', { counts });
  assert.equal(s.lots[0].quantity, 8);
  assert.equal(sales(s.shifts[0].rows[0]), 13);
  s = run(s, 'open', { date, period: 'Tarde', responsible: 'Luis' });
  assert.equal(s.shifts[1].rows[0].opening, 4);
  assert.equal(s.shifts[1].rows[0].incoming, 0);
});
test('rechaza retiros negativos, stock insuficiente y conversiones antiguas', () => {
  let s = open();
  assert.equal(s.shifts[0].rows[0].waste, 0);
  s = run(s, 'produce', { productId: 'p1', quantity: 1, responsible: 'Cocinera', date });
  assert.throws(() => run(s, 'replenish', { productId: 'p1', lotId: s.lots[0].id, quantity: 2 }));
  assert.throws(() => run(s, 'replenish', { productId: 'p1', lotId: s.lots[0].id, quantity: 1, output: 12 }));
  assert.throws(() => run(s, 'replenish', { productId: 'p1', lotId: s.lots[0].id, quantity: -1 }));
  assert.equal(s.lots[0].quantity, 1);
});
test('exige conteo completo, impide ventas negativas y protege cierres', () => {
  let s = open();
  assert.throws(() => run(s, 'open', { date, period: 'Tarde', responsible: 'Ana' }));
  assert.throws(() => run(s, 'close', { counts: { p1: 4 } }));
  const counts = Object.fromEntries(s.products.map(p => [p.id, p.id === 'p1' ? 6 : 0]));
  assert.throws(() => run(s, 'close', { counts }));
  counts.p1 = 0;
  s = run(s, 'close', { counts });
  assert.throws(() => run(s, 'close', { counts }));
  assert.throws(() => run(s, 'open', { date, period: 'Mañana', responsible: 'Ana' }));
});
test('impide escrituras con una revisión antigua', () => {
  const s = open();
  assert.throws(() => execute(s, { type: 'product', revision: 0, productId: 'p1', name: 'Otro', yield: 8, minimum: 3 }), /datos cambiaron/);
});
test('cada croissant horneado suma una unidad al mostrador', () => {
  let s = open();
  s = run(s, 'produce', { productId: 'v1', quantity: 60, responsible: 'Cocinera', date });
  s = run(s,'bakeBatch',{items:[{productId:'v1',quantity:15}],responsible:'Cocinera',date,period:'Mañana'});
  s = run(s, 'replenish', { productId: 'v1', lotId: s.lots[0].id, quantity: 15 });
  assert.equal(s.lots[0].quantity, 45);
  assert.equal(s.shifts[0].rows.find(r => r.productId === 'v1')?.incoming, 15);
  assert.match(s.movements[0].note, /15 unidades retiradas de horneados/);
});
test('permite añadir productos al turno abierto sin alterar los cierres anteriores', () => {
  let s = open();
  s = run(s, 'createProduct', { name: 'Nuevo postre', category: 'Postres', yield: 1, minimum: 2 });
  const added = s.products.at(-1)!;
  assert.deepEqual(s.shifts[0].rows.at(-1), { productId: added.id, opening: 0, incoming: 0, waste: 0, closing: null });
  assert.throws(() => run(s, 'createProduct', { name: 'nuevo postre', category: 'Postres', yield: 1, minimum: 0 }), /Ya existe/);
  assert.throws(() => run(s, 'createProduct', { name: 'Otro', category: 'Bollería', yield: 12, minimum: 0 }), /unidad/);
  const counts = Object.fromEntries(s.products.map(p => [p.id, 0]));
  s = run(s, 'close', { counts });
  s = run(s, 'createProduct', { name: 'Pieza', category: 'Bollería', yield: 1, minimum: 1 });
  assert.equal(s.shifts[0].rows.length, s.products.length - 1);
  s = run(s, 'open', { date: limaDate(), period: 'Tarde', responsible: 'Luis' });
  assert.equal(s.shifts[1].rows.length, s.products.length);
});
test('asocia movimientos nuevos al turno actual y mantiene producción externa sin turno', () => {
  let s = seed();
  s = run(s, 'produce', { productId: 'p1', quantity: 1, responsible: 'Cocinera', date });
  assert.equal(s.movements[0].shiftId, undefined);
  s = run(s, 'open', { date, period: 'Mañana', responsible: 'Ana' });
  s = run(s, 'produce', { productId: 'p1', quantity: 2, responsible: 'Cocinera', date });
  assert.equal(s.movements[0].shiftId, s.shifts[0].id);
});
test('valida respaldos completos y rechaza referencias, cantidades o cierres inválidos', () => {
  let valid = open();
  valid = run(valid, 'produce', { productId: 'p1', quantity: 1, responsible: 'Cocinera', date });
  assert.deepEqual(validateBackup(valid), valid);
  const legacy = structuredClone(valid);
  delete legacy.movements[0].shiftId;
  assert.deepEqual(validateBackup(legacy), legacy);
  const bad = structuredClone(valid);
  bad.shifts[0].rows[0].waste = 100;
  assert.throws(() => validateBackup(bad), /respaldo/);
  bad.shifts[0].rows[0].waste = 0;
  bad.lots.push({ id: 'lote', productId: 'desconocido', quantity: 1, producedAt: date, note: '' });
  assert.throws(() => validateBackup(bad), /respaldo/);
  bad.lots.pop();
  bad.movements[0].shiftId = 'turno-falso';
  assert.throws(() => validateBackup(bad), /respaldo/);
  assert.throws(() => validateBackup({ products: [] }), /respaldo/);
});

test('los lotes anteriores tampoco multiplican las unidades retiradas', () => {
  let s = open();
  s = run(s, 'produce', { productId: 'p1', quantity: 4, responsible: 'Cocinera', date });
  s.lots[0].yield = 12; // Dato histórico conservado, sin uso en el flujo actual.
  const lotId = s.lots[0].id;
  s = run(s, 'replenish', { productId: 'p1', lotId, quantity: 2 });
  assert.equal(s.shifts[0].rows[0].incoming, 2);
  assert.equal(s.lots[0].quantity, 2);
  assert.deepEqual(validateBackup(s), s);
  assert.throws(() => run(s, 'replenish', { productId: 'p1', lotId, quantity: 1, output: 12 }), /unidades/);
});

test('no permite nuevos registros de descarte y conserva los ajustes históricos', () => {
  const s = open();
  assert.throws(() => run(s, 'waste', { productId: 'p1', quantity: 1, note: 'No registrar' }), /desconocida/);
  const previous = structuredClone(s);
  previous.shifts[0].rows[0].waste = 1;
  const validated = validateBackup(previous);
  assert.equal(validated.shifts[0].rows[0].waste, 1);
  assert.equal(sales({ ...validated.shifts[0].rows[0], closing: 1 }), 3);
});

test('el responsable de cocina es independiente del responsable del mostrador', () => {
  const s = open();
  for (const responsible of ['Ana', ' ana ', 'ANA']) {
    assert.throws(() => run(s, 'produce', { productId: 'p1', quantity: 2, responsible, date }), /distinto/);
  }
  const produced = run(s, 'produce', { productId: 'p1', quantity: 2, responsible: 'Cocinera Elena', date });
  assert.equal(produced.shifts[0].responsible, 'Ana');
  assert.equal(produced.lots[0].responsible, 'Cocinera Elena');
  assert.equal(produced.movements[0].responsible, 'Cocinera Elena');
  assert.deepEqual(validateBackup(produced), produced);
});
