'use client';
import { useState } from 'react';
import type { Product, Shift, State } from '@/lib/inventory';
import {shiftLabel} from '@/lib/inventory';
import { dailyProductSales, salesSummary } from '@/lib/sales-summary';
import { allSalesShifts } from '@/lib/excel-history';

export function ShiftSalesCard({ shift, products, counts = {} }: { shift?: Shift; products: Product[]; counts?: Record<string,string> }) {
  const summary = salesSummary(shift, products, counts);
  const max = Math.max(1,...summary.items.map(i=>i.quantity));
  return <section className="panel sales-dashboard" aria-label="Resumen de venta calculada">
    <div className="panel-heading"><div><h2>Venta calculada del turno <span className={summary.complete ? 'pill green' : 'pill'}>{summary.complete ? 'Cierre guardado' : 'Provisional'}</span></h2><p>{shift ? `${shift.date} · ${shift.period} · ${shiftLabel(shift)}` : 'Selecciona o abre un turno.'}</p></div></div>
    <div className="sales-metrics"><div><strong>{summary.counted ? summary.total : '—'}</strong><span>unidades vendidas calculadas</span></div><div><strong>{summary.items.length}</strong><span>productos con ventas</span></div><div><strong>{summary.counted}/{shift?.rows.length ?? 0}</strong><span>productos contados</span></div></div>
    {!summary.complete && <p className="sales-note">{summary.counted === 0 ? 'Completa los conteos de cierre en Turno actual para ver el resultado.' : `${summary.pending} productos pendientes o con conteos por revisar. Solo se suman los conteos válidos.`}</p>}
    {summary.items.length ? <div className="sales-ranking">{summary.items.map(i=><div className="sales-ranking-row" key={i.id}><div><span>{i.name}</span><strong>{i.quantity} uds.</strong></div><div className="sales-track"><span style={{width:`${i.quantity/max*100}%`}}/></div></div>)}</div> : <div className="empty">{summary.counted ? 'No hay ventas calculadas en los productos contados.' : 'El detalle por producto aparecerá al contar.'}</div>}
    <p className="sales-note">Incluye las unidades pagadas por trabajadores. Pendiente de comparar con caja; no muestra transacciones individuales ni sabores de croissants que comparten base.</p>
  </section>;
}
export function SalesOverview({ state, counts }: { state: State; counts: Record<string,string> }) {
  const shifts=allSalesShifts(state);
  const [selected,setSelected] = useState(state.shifts.at(-1)?.id ?? shifts.at(-1)?.id ?? '');
  const dates = [...new Set(shifts.map(shift => shift.date))].sort().reverse();
  const [selectedDate,setSelectedDate] = useState(dates[0] ?? '');
  const date = dates.includes(selectedDate) ? selectedDate : dates[0] ?? '';
  const [category,setCategory]=useState<Product['category']|'Todos'>('Todos');
  const daily = dailyProductSales(date, shifts, state.products, counts,category);
  const shift = shifts.find(s=>s.id===selected);
  return <>
    <section className="panel sales-dashboard" aria-label="Ventas diarias de productos">
      <div className="panel-heading"><div><h2>Productos vendidos en el día <span className={daily.complete ? 'pill green' : 'pill'}>{daily.complete ? 'Ambos turnos cerrados' : 'Parcial'}</span></h2><p>Suma de los turnos de mañana y tarde de la misma fecha.</p></div><label className="daily-date">Fecha<select value={date} onChange={e=>setSelectedDate(e.target.value)} disabled={!dates.length}>{!dates.length && <option value="">Sin turnos registrados</option>}{dates.map(day=><option key={day} value={day}>{day}</option>)}</select></label></div>
      <label className="daily-date">Categoría<select value={category} onChange={e=>setCategory(e.target.value as typeof category)}><option value="Todos">Todos</option><option>Postres</option><option>Bollería</option></select></label>
      <div className="sales-metrics">
        <div><strong>{daily.counted ? daily.total : '—'}</strong><span>productos vendidos en total</span></div>
        {daily.periods.map(({period,shift,summary})=><div key={period}><strong>{summary.counted ? summary.total : '—'}</strong><span>{period} · {!shift ? 'Sin turno registrado' : shift.status === 'closed' ? 'Cerrado' : 'En curso'}</span></div>)}
      </div>
      {!daily.complete && <p className="sales-note">Total parcial: faltan turnos, conteos o productos del catálogo en el archivo histórico. Solo suma conteos válidos; «—» indica que no hay un conteo disponible.</p>}
      {daily.items.length ? <div className="table-wrap" role="region" aria-label="Productos vendidos por día y turno" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>MAÑANA</th><th>TARDE</th><th>TOTAL DEL DÍA</th></tr></thead><tbody>{daily.items.map(item=><tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.category}</td><td>{item.morning ?? '—'}</td><td>{item.afternoon ?? '—'}</td><td className="sale"><strong>{item.total}</strong></td></tr>)}</tbody></table></div> : <div className="empty">{daily.counted ? 'No hay ventas de productos en los conteos disponibles de esta fecha.' : 'El resumen aparecerá cuando se registren conteos de cierre.'}</div>}
      <p className="sales-note daily-footer">Unidades calculadas a partir del inventario. Incluye postres y bollería. Los totales corresponden a la categoría seleccionada.</p>
    </section>
    <label className="history-picker">Turno a consultar<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Selecciona un turno</option>{shifts.toReversed().map(s=><option value={s.id} key={s.id}>{s.date} · {s.period} · {s.id.startsWith('excel:')?'Histórico Excel':s.status==='open' ? 'En curso' : 'Cerrado'}</option>)}</select></label><ShiftSalesCard shift={shift} products={state.products} counts={counts}/></>;
}
