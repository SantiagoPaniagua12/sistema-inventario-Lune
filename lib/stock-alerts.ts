import { available, type State } from './inventory';
import { unitLabel } from './supplies';
export type StockAlert = { id: string; productId: string; name: string; section: string; stock: number; minimum: number | null; unit: string; estimated: boolean; empty: boolean };
export function stockAlerts(state: State) {
  const alerts: StockAlert[] = [];
  let missingCounts = 0, missingMinimums = 0;
  const latest = state.shifts.at(-1);
  for (const product of state.products) {
    const row = latest?.rows.find(row=>row.productId===product.id);
    if (row&&state.visibility?.display!==false) {
      const stock = latest?.status === 'closed' ? row.closing : available(row);
      if (stock !== null && stock <= product.minimum) alerts.push({ id:`display:${product.id}`, productId:product.id, name:product.name, section:'Mostrador', stock, minimum:product.minimum, unit:'unidades', estimated:latest?.status === 'open', empty:stock===0 });
    } else if(state.visibility?.display!==false) missingCounts++;
    if(state.visibility?.reserve===false)continue;
    const lots = state.lots.filter(lot=>lot.productId===product.id);
    const minimum = product.reserveMinimum ?? null;
    if (minimum === null) missingMinimums++;
    if (!lots.length) { missingCounts++; continue; }
    const stock = lots.reduce((sum,lot)=>sum+lot.quantity,0);
    if (stock === 0 || minimum !== null && stock <= minimum) alerts.push({ id:`reserve:${product.id}`, productId:product.id, name:product.name, section:'Reserva congelada', stock, minimum, unit:'unidades', estimated:false, empty:stock===0 });
  }
  for (const supply of state.supplies ?? []) {
    if (supply.minimum === null) missingMinimums++;
    if (supply.stock === null) { missingCounts++; continue; }
    if (supply.stock === 0 || supply.minimum !== null && supply.stock <= supply.minimum) alerts.push({ id:`supply:${supply.id}`, productId:supply.id, name:supply.name, section:supply.group, stock:supply.stock, minimum:supply.minimum, unit:unitLabel(supply.unit), estimated:supply.estimated, empty:supply.stock===0 });
  }
  alerts.sort((a,b)=>Number(b.empty)-Number(a.empty) || a.section.localeCompare(b.section,'es') || a.name.localeCompare(b.name,'es'));
  return { alerts, missingCounts, missingMinimums };
}
