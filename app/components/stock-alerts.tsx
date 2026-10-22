'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { stockAlerts } from '@/lib/stock-alerts';
import type { State } from '@/lib/inventory';

export function StockNotice({state,onOpen}:{state:State;onOpen:()=>void}) {
  const {alerts}=stockAlerts(state);
  const previous=useRef<Map<string,number>>(new Map());
  const [message,setMessage]=useState('');
  const signature=JSON.stringify(alerts.map(alert=>[alert.id,alert.stock,alert.name,alert.section]));
  useEffect(()=>{
    const changed=alerts.filter(alert=>!previous.current.has(alert.id) || alert.stock<previous.current.get(alert.id)!);
    previous.current=new Map(alerts.map(alert=>[alert.id,alert.stock]));
    if(changed.length) setMessage(`${changed.length} ${changed.length===1?'producto requiere':'productos requieren'} atención: ${changed.slice(0,3).map(alert=>`${alert.name} (${alert.section}: ${alert.stock} ${alert.unit})`).join('; ')}${changed.length>3?'…':''}`);
    else setMessage(alerts.length?`Pendientes: ${alerts.slice(0,3).map(alert=>`${alert.name} (${alert.section})`).join('; ')}${alerts.length>3?'…':''}`:'');
  // Changes in stock trigger a new notice; ordinary renders do not.
  },[signature]);
  return <div className="stock-notice" role="status" aria-live="polite"><BellRing size={18}/><div><strong>{alerts.length} alertas de inventario</strong><span>{alerts.length ? message || 'Revisa los productos que están por acabarse.' : 'Sin alertas en los saldos registrados.'}</span></div><button className="text-button" onClick={onOpen}>Ver cuadro general</button></div>;
}
export function StockAlertsPanel({state}:{state:State}) {
  const {alerts,missingCounts,missingMinimums}=stockAlerts(state);
  const [section,setSection]=useState('Todas');
  const [query,setQuery]=useState('');
  const sections=[...new Set(alerts.map(alert=>alert.section))];
  const visible=alerts.filter(alert=>(section==='Todas'||alert.section===section)&&alert.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  return <section className="panel">
    <div className="panel-heading"><div><h2><Bell size={20}/> Productos por acabarse</h2><p>Avisos de todas las secciones: agotados, por debajo o justo en el mínimo.</p></div><span className="pill">{alerts.length} alertas</span></div>
    <div className="sales-metrics"><div><strong>{alerts.filter(alert=>alert.empty).length}</strong><span>agotados</span></div><div><strong>{alerts.filter(alert=>!alert.empty).length}</strong><span>en el mínimo o por debajo</span></div><div><strong>{missingCounts}</strong><span>saldos sin conteo o registro inicial</span></div></div>
    <div className="supply-toolbar"><label>Sección<select value={section} onChange={e=>setSection(e.target.value)}><option>Todas</option>{sections.map(item=><option key={item}>{item}</option>)}</select></label><label>Buscar producto<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre del producto"/></label></div>
    <div className="table-wrap" role="region" aria-label="Alertas de todas las secciones" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>SECCIÓN</th><th>DISPONIBLE</th><th>MÍNIMO</th><th>ESTADO</th></tr></thead><tbody>{visible.map(alert=><tr key={alert.id}><td><strong>{alert.name}</strong></td><td>{alert.section}</td><td>{alert.estimated?'≈ ':''}{alert.stock} {alert.unit}</td><td>{alert.minimum ?? 'Sin definir'}</td><td><span className={`pill ${alert.empty?'low-pill':''}`}>{alert.empty?'Agotado':alert.stock===alert.minimum?'En el mínimo':'Bajo el mínimo'}</span></td></tr>)}</tbody></table>{!visible.length&&<div className="empty">No hay alertas para esta búsqueda.</div>}</div>
    <p className="sales-note daily-footer">{missingMinimums} mínimos pendientes de definir. Los saldos sin conteo no se tratan como cero. Configura mínimos de reserva en Productos y los de insumos en su sección. En mostrador, ≈ indica disponible antes del conteo; las ventas se descuentan al cerrar el turno. Los líquidos estimados también llevan ≈.</p>
    <p className="sales-note">Los avisos aparecen dentro del sistema al detectar un producto bajo o una reducción adicional. Se actualizan cada 30 segundos mientras la página está visible y no hay formularios abiertos. Para recibirlos, mantén la aplicación abierta.</p>
  </section>;
}
