import { available, type Product, type Shift } from './inventory';
export function salesSummary(shift: Shift | undefined, products: Product[], counts: Record<string,string> = {}) {
  if (!shift) return { total: 0, counted: 0, pending: 0, items: [], complete: false };
  let counted = 0;
  const items = shift.rows.flatMap(row => {
    const raw = counts[row.productId];
    const closing = shift.status === 'closed' ? row.closing : raw === undefined || raw.trim() === '' ? null : Number(raw);
    if (closing === null || !Number.isSafeInteger(closing) || closing < 0 || closing > available(row)) return [];
    counted++;
    const quantity = available(row) - closing;
    if (!quantity) return [];
    return [{ id: row.productId, name: products.find(p => p.id === row.productId)?.name ?? 'Producto', quantity }];
  }).sort((a,b) => b.quantity-a.quantity || a.name.localeCompare(b.name,'es'));
  return { total: items.reduce((n,i)=>n+i.quantity,0), counted, pending: shift.rows.length-counted, items, complete: shift.status === 'closed' };
}

export function dailyDessertSales(date: string, shifts: Shift[], products: Product[], counts: Record<string,string> = {}) {
  const desserts = products.filter(product => product.category === 'Postres');
  const ids = new Set(desserts.map(product => product.id));
  const periods = (['Mañana', 'Tarde'] as const).map(period => {
    const source = shifts.find(shift => shift.date === date && shift.period === period);
    const shift = source ? { ...source, rows: source.rows.filter(row => ids.has(row.productId)) } : undefined;
    return { period, shift, summary: salesSummary(shift, desserts, counts) };
  });
  const items = desserts.map(product => {
    const quantities = periods.map(({ shift }) => {
      if (!shift) return null;
      const row = shift.rows.find(row => row.productId === product.id);
      if (!row) return null;
      const summary = salesSummary({ ...shift, rows: [row] }, desserts, counts);
      return summary.counted ? summary.total : null;
    });
    return { id: product.id, name: product.name, morning: quantities[0], afternoon: quantities[1], total: quantities.reduce<number>((sum, quantity) => sum + (quantity ?? 0), 0) };
  }).filter(item => item.total > 0).sort((a,b) => b.total-a.total || a.name.localeCompare(b.name,'es'));
  return {
    periods, items,
    total: periods.reduce((sum, period) => sum + period.summary.total, 0),
    counted: periods.reduce((sum, period) => sum + period.summary.counted, 0),
    complete: periods.every(({ shift, summary }) => shift?.status === 'closed' && summary.pending === 0 && summary.counted === desserts.length),
  };
}
