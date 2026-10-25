'use client';
import {useState} from 'react';
import type {State,Product} from '@/lib/inventory';
import {allSalesShifts} from '@/lib/excel-history';
import {displayTransfers} from '@/lib/display-transfers';

export function DisplayTransfers({state}:{state:State}) {
  const shifts=state.transferShifts??allSalesShifts(state);
  const dates=[...new Set(shifts.map(shift=>shift.date))].sort().reverse();
  const [selectedDate,setDate]=useState(dates[0]??'');
  const [category,setCategory]=useState<Product['category']|'Todos'>('Postres');
  const [period,setPeriod]=useState<'Todos'|'Mañana'|'Tarde'>('Todos');
  const date=dates.includes(selectedDate)?selectedDate:dates[0]??'';
  const report=displayTransfers(date,shifts,state.products,category);
  const items=report.items.filter(item=>period==='Todos'||(period==='Mañana'?item.morning:item.afternoon));
  const total=period==='Todos'?report.total:period==='Mañana'?report.morning:report.afternoon;
  const relevantPeriods=report.periods.filter(item=>period==='Todos'||item.period===period);
  return <section className="panel sales-dashboard" aria-label="Reporte de salidas de reserva al mostrador">
    <div className="panel-heading"><div><h2>Salidas de reserva al mostrador</h2><p>Qué productos ingresaron al mostrador y cuántas unidades, por fecha y turno.</p></div></div>
    <div className="supply-toolbar">
      <label>Fecha<select value={date} onChange={event=>setDate(event.target.value)} disabled={!dates.length}>{!dates.length&&<option value="">Sin turnos registrados</option>}{dates.map(day=><option key={day}>{day}</option>)}</select></label>
      <label>Turno<select value={period} onChange={event=>setPeriod(event.target.value as typeof period)}><option value="Todos">Día y tarde</option><option value="Mañana">Día (mañana)</option><option value="Tarde">Tarde</option></select></label>
      <label>Productos<select value={category} onChange={event=>setCategory(event.target.value as typeof category)}><option>Postres</option><option value="Bollería">Croissants y rolls</option><option>Todos</option></select></label>
    </div>
    <div className="sales-metrics"><div><strong>{relevantPeriods.some(item=>item.shift)?total:'—'}</strong><span>unidades ingresadas · {items.length} productos</span></div>{report.periods.map(({period,shift})=><div key={period}><strong>{shift?(period==='Mañana'?report.morning:report.afternoon):'—'}</strong><span>{period==='Mañana'?'Día (mañana)':'Tarde'} · {!shift?'Sin turno registrado':shift.id.startsWith('excel:')?'Histórico Excel':shift.status==='open'?'En curso':'Cerrado'}</span></div>)}</div>
    <div className="table-wrap" role="region" aria-label="Productos ingresados por turno" tabIndex={0}><table><thead><tr><th>PRODUCTO</th>{period!=='Tarde'&&<th>DÍA (MAÑANA)</th>}{period!=='Mañana'&&<th>TARDE</th>}<th>{period==='Todos'?'TOTAL DEL DÍA':'TOTAL DEL TURNO'}</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><strong>{item.name}</strong></td>{period!=='Tarde'&&<td>{item.morning??'—'}</td>}{period!=='Mañana'&&<td>{item.afternoon??'—'}</td>}<td className="incoming"><strong>{period==='Todos'?item.total:period==='Mañana'?item.morning:item.afternoon}</strong></td></tr>)}</tbody><tfoot><tr><td><strong>Total</strong></td>{period!=='Tarde'&&<td>{report.periods[0].shift?report.morning:'—'}</td>}{period!=='Mañana'&&<td>{report.periods[1].shift?report.afternoon:'—'}</td>}<td><strong>{relevantPeriods.some(item=>item.shift)?total:'—'}</strong></td></tr></tfoot></table></div>
    {!items.length&&<div className="empty">{relevantPeriods.some(item=>item.shift)?'No hay ingresos de estos productos en la fecha y turno seleccionados.':'No hay un turno registrado para esta selección.'}</div>}
    <p className="sales-note daily-footer">Muestra los ingresos netos guardados en cada turno, incluidas sus correcciones. La entrada heredada del turno anterior y las ventas no se suman. Un turno en curso puede recibir más ingresos; «—» indica que no hay registro. Los históricos de Excel muestran sus ingresos importados y no representan nuevos descuentos de la reserva actual.</p>
  </section>;
}
