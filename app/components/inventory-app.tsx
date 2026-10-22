'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LayoutDashboard, Snowflake, ClipboardList, History, Settings2, Plus, ArrowUpRight, Check, X, ChevronRight, Download, CircleHelp, Croissant, CakeSlice, RefreshCw, Menu, Boxes, SprayCan, BarChart3, Bell, Upload } from 'lucide-react';
import { available, sales, limaDate, oldestAvailableLot, type State } from '@/lib/inventory';
import { SuppliesWorkspace } from './supplies-workspace';
import { ShiftSalesCard, SalesOverview } from './sales-dashboard';
import { StockNotice, StockAlertsPanel } from './stock-alerts';
import { ExcelImportWorkspace } from './excel-import';
import { allSalesShifts } from '@/lib/excel-history';
import { COOKS, WAITERS } from '@/lib/staff';
import {BrandLogo} from './brand-logo';
import {ShiftCorrection} from './shift-correction';
import {DisplayTransfers} from './display-transfers';

type View = 'Turno actual' | 'Reserva congelada' | 'Historial' | 'Productos' | 'Insumos y bebidas' | 'Limpieza' | 'Ventas por turno' | 'Salidas al mostrador' | 'Alertas de inventario' | 'Importar Excel';
type Modal = 'open' | 'produce' | 'replenish' | 'product' | 'createProduct' | 'restore' | null;
const icons = { 'Turno actual': LayoutDashboard, 'Reserva congelada': Snowflake, Historial: History, Productos: Settings2, 'Insumos y bebidas': Boxes, Limpieza: SprayCan, 'Ventas por turno': BarChart3, 'Salidas al mostrador':ArrowUpRight, 'Alertas de inventario':Bell, 'Importar Excel':Upload };
const fmt = (date: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' }).format(new Date(`${date}T12:00:00-05:00`));

import type { Actor } from '@/lib/access';
export default function Home({actor}:{actor:Actor}) {
  const admin=actor.role==='admin',cook=admin||actor.role==='cocina',waiter=admin||actor.role==='mozo';
  async function logout(){const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok)window.location.assign('/login');else setError('No se pudo cerrar la sesión. Reintenta.');}
  const [state, setState] = useState<State | null>(null);
  const [storage, setStorage] = useState('json');
  const [reserveMode, setReserveMode] = useState<'produccion' | 'frutas'>('produccion');
  const [view, setView] = useState<View>(actor.role==='cocina'?'Reserva congelada':'Turno actual');
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState('p1');
  const [filter, setFilter] = useState('Todos');
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyId, setHistoryId] = useState('');
  const [closingResponsible,setClosingResponsible]=useState('');
  const [mobile, setMobile] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [newCategory, setNewCategory] = useState('Postres');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const modalRef=useRef(modal); modalRef.current=modal;
  async function refresh() {
    try { const response = await fetch('/api/inventory', { cache: 'no-store' }); const result = await response.json(); if(response.status===401){window.location.assign('/login');return;} if(response.status===428){window.location.assign('/cuenta');return;} if (!response.ok) throw new Error(result.error || 'No se pudo cargar el inventario.'); setState(previous=>!previous||result.revision>=previous.revision?result:previous); setStorage(response.headers.get('X-Inventory-Storage') || 'json'); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); const timer=setInterval(()=>{if(!busyRef.current&&!modalRef.current&&document.visibilityState==='visible')void refresh();},30000); return ()=>clearInterval(timer); }, []);
  async function command(data: Record<string, unknown>, message: string) {
    if (!state || busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, revision: state.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar.');
      setState(result); setNotice(message); setModal(null);
      if (data.type === 'close' || data.type === 'open') setCounts({});
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const active = state?.shifts.find(s => s.status === 'open');
  const latest = state?.shifts.at(-1);
  const historyShifts=state?allSalesShifts(state):[];
  const displayed = view === 'Historial' ? historyShifts.find(s => s.id === historyId) : active ?? latest;
  useEffect(()=>{setCounts({});setClosingResponsible('');},[active?.id]);
  const products = state?.products.filter(p => (filter === 'Todos' || p.category === filter) && p.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const chosen = state?.products.find(p => p.id === selected);
  const oldestLot = oldestAvailableLot(state?.lots ?? [], selected);
  const rows = displayed?.rows ?? [];
  const historicalMovements = state?.movements.filter(m => m.shiftId === historyId).slice(0, 100) ?? [];
  const unassignedMovements = state?.movements.filter(m => !m.shiftId) ?? [];
  const total = (key: 'opening' | 'incoming' | 'waste') => rows.reduce((n, r) => n + r[key], 0);
  const counted = active?.rows.filter(r => counts[r.productId] !== undefined && counts[r.productId] !== '').length ?? 0;
  function show(kind: Modal, id?: string) { setError(''); setRestoreFile(null); setNewCategory('Postres'); setSelected(id ?? state?.products[0]?.id ?? 'p1'); setModal(kind); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    for (const key of ['quantity', 'minimum']) if (key in data) (data as Record<string, unknown>)[key] = Number(data[key]);
    if('reserveMinimum' in data) (data as Record<string,unknown>).reserveMinimum=data.reserveMinimum===''?null:Number(data.reserveMinimum);
    const openings = Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith('initial:')).map(([k, v]) => [k.slice(8), Number(v)]));
    void command({ ...data, type: modal, ...(modal === 'product' ? { productId: selected } : {}), ...(modal === 'open' ? { openings } : {}) }, modal === 'open' ? 'Turno abierto. Ya puedes registrar unidades retiradas de producción.' : modal === 'createProduct' ? 'Producto agregado al catálogo.' : 'Movimiento guardado correctamente.');
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `lune-respaldo-${limaDate()}.json`; link.click(); URL.revokeObjectURL(link.href);
  }
  async function restoreData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !restoreFile || busy) return;
    if (!window.confirm('¿Reemplazar todos los turnos, lotes, productos y movimientos con este respaldo? Esta acción no se puede deshacer. Exporta primero el estado actual.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (restoreFile.size > 5_000_000) throw new Error('El respaldo supera el límite de 5 MB.');
      const backup = JSON.parse(await restoreFile.text());
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'restore', revision: state.revision, backup }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo restaurar el respaldo.');
      setState(result); setCounts({}); setHistoryId(''); setModal(null); setNotice('Respaldo restaurado correctamente.');
    } catch (e) { setError(e instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>('form input,form select,form button')?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) { e.preventDefault(); setModal(null); }
      if (e.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [modal]);
  return <div className="shell">
    <aside className={mobile ? 'sidebar expanded' : 'sidebar'}>
      <a className="brand" href="/" aria-label="Lune Alta Pastelería · Inicio"><BrandLogo/></a>
      <div className="workspace"><span className="workspace-icon">L</span><div>Lune · Arequipa<small>Gestión de inventario</small></div><span className="beta">BETA</span></div>
      <p className="nav-label">ESPACIO DE TRABAJO</p>
      <nav>{(Object.keys(icons) as View[]).filter(item=>admin||!['Productos','Importar Excel'].includes(item)).map(item => { const Icon = icons[item]; return <button className={view === item ? 'nav-item active' : 'nav-item'} key={item} onClick={() => { setView(item); setMobile(false); setFilter('Todos'); setQuery(''); if (item === 'Historial') setHistoryId(historyShifts.filter(s => s.status === 'closed').at(-1)?.id ?? ''); }}><Icon size={19} />{item}{view === item && <ChevronRight size={15} />}</button>; })}</nav>
      <div className="sidebar-note"><CircleHelp size={20} /><strong>Todo empieza con un buen conteo.</strong><p>Registra las unidades retiradas de producción y cuenta el mostrador al cerrar.</p></div>
      <div className="sidebar-bottom"><span className="avatar">L</span><div>{actor.name}<small>{actor.role}</small></div><span className="online" /></div>
    </aside>
    <main>
      <header className="topbar"><div><button className="mobile-menu icon-button" onClick={() => setMobile(!mobile)} aria-label={mobile ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={mobile}><Menu size={20}/></button><span>Inventario</span><ChevronRight size={14}/><strong>{view}</strong></div><span className="local-status"><span className="online"/>{storage === 'supabase' ? 'Supabase' : storage === 'postgres' ? 'PostgreSQL local' : 'Beta local'}</span></header>
      <div className="content"><div className="account-strip"><span>{actor.name} · {actor.role}</span><a href="/cuenta">Mi contraseña</a>{admin&&<a href="/admin/usuarios">Equipo y permisos</a>}<button className="text-button" onClick={logout}>Cerrar sesión</button></div>
         <div className="heading"><div><div className="eyebrow">EL DETALLE HACE LA DIFERENCIA</div><h1>{view}</h1><p>{view === 'Turno actual' ? 'Cada unidad cuenta. Lleva el control de tu mostrador.' : view === 'Reserva congelada' ? 'Tu próxima reposición empieza aquí.' : view === 'Salidas al mostrador' ? 'Consulta los productos ingresados desde reserva por fecha y turno.' : view === 'Historial' ? 'Cada turno y cada movimiento, en un solo lugar.' : 'El catálogo que da forma a tu inventario.'}</p></div><div className="heading-actions"><button className="icon-button" onClick={refresh} aria-label="Actualizar datos"><RefreshCw size={18}/></button>{view === 'Reserva congelada' && reserveMode === 'produccion' && cook ? <button className="primary" disabled={!state} onClick={() => show('produce')}><Plus size={17}/>Registrar producción</button> : view === 'Turno actual' && !active && waiter ? <button className="primary" disabled={!state} onClick={() => show('open')}><Plus size={17}/>Abrir turno</button> : view === 'Productos' && admin ? <button className="primary" disabled={!state} onClick={() => show('createProduct')}><Plus size={17}/>Nuevo producto</button> : admin && <button className="secondary" disabled={!state} onClick={exportData}><Download size={16}/>Exportar respaldo</button>}</div></div>
        <div className="demo-banner"><span className="demo-dot"/>Beta 0.2 · Postres por unidades, frutas por porciones e insumos por presentación. Registra conteos iniciales y mínimos reales.</div>
        {error && <div role="alert" className="alert error">{error}<button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
         {notice && <div role="status" className="alert success"><Check size={17}/>{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
        {state&&<StockNotice state={state} onOpen={()=>setView('Alertas de inventario')}/>}
        {!state ? <div className="empty">Cargando inventario… {error && <button onClick={refresh}>Reintentar</button>}</div> : <>
        {view === 'Reserva congelada' && <div className="reserve-mode tabs" aria-label="Tipo de reserva"><button className={reserveMode==='produccion'?'selected':''} onClick={()=>setReserveMode('produccion')}>Postres y viennoiserie</button><button className={reserveMode==='frutas'?'selected':''} onClick={()=>setReserveMode('frutas')}>Frutas por porciones</button></div>}
        {view === 'Reserva congelada' && reserveMode === 'frutas' && <SuppliesWorkspace actor={actor} key="frutas" state={state} groups={['Frutas congeladas']} busy={busy} error={error} onCommand={command}/>}
        {view === 'Insumos y bebidas' && <SuppliesWorkspace actor={actor} key="insumos" state={state} groups={['Insumos','Bebidas','Empaques','Preparados líquidos','Cocina']} busy={busy} error={error} onCommand={command}/>}
        {view === 'Limpieza' && <SuppliesWorkspace actor={actor} key="limpieza" state={state} groups={['Limpieza']} busy={busy} error={error} onCommand={command}/>}
        {view === 'Ventas por turno' && <SalesOverview state={state} counts={counts}/>}
        {view === 'Salidas al mostrador' && <DisplayTransfers state={state}/>}
        {view === 'Alertas de inventario' && <StockAlertsPanel state={state}/>}
        {view === 'Importar Excel' && <ExcelImportWorkspace state={state} busy={busy} onCommand={command}/>}
        {(view === 'Turno actual' || view === 'Historial') && <>
          <div className="stats"><Stat label="ENTRADA DEL TURNO" value={total('opening')} detail="Unidades recibidas" icon={<ClipboardList size={19}/>}/><Stat label="RETIRADAS DE PRODUCCIÓN" value={total('incoming')} detail="Unidades ingresadas al mostrador" icon={<ArrowUpRight size={20}/>}/><Stat label={displayed?.status === 'closed' ? 'VENTA CALCULADA' : 'DISPONIBLE ANTES DEL CONTEO'} value={displayed?.status === 'closed' ? rows.reduce((n,r) => n + (sales(r) ?? 0),0) : rows.reduce((n,r) => n + available(r),0)} detail={displayed?.status === 'closed' ? 'Según movimiento físico' : 'Aún no descuenta ventas'} icon={<CakeSlice size={20}/>}/></div>
          <ShiftSalesCard shift={displayed} products={state.products} counts={counts}/>
          {view === 'Historial' && <label className="history-picker">Consultar turno<select value={historyId} onChange={e => setHistoryId(e.target.value)}><option value="">Selecciona un cierre</option>{historyShifts.filter(s => s.status === 'closed').toReversed().map(s => <option key={s.id} value={s.id}>{s.date} · {s.period} · {s.responsible}</option>)}</select></label>}
          {view==='Historial'&&displayed?.id.startsWith('excel:')&&<p className="alert warning">Archivo histórico de Excel. Solo muestra los postres importados y no modifica el saldo del mostrador ni la reserva actual.</p>}
          <section className="panel"><div className="panel-heading"><div><h2>Control del mostrador <span className={active && view === 'Turno actual' ? 'pill green' : 'pill'}>{active && view === 'Turno actual' ? 'En curso' : displayed ? 'Cerrado' : 'Sin turno'}</span></h2><p>{displayed ? `${fmt(displayed.date)} · Turno ${displayed.period.toLowerCase()} · Responsable: ${displayed.responsible}` : 'Abre el primer turno e ingresa el conteo inicial del mostrador.'}</p></div>{active && view === 'Turno actual' && waiter && <div className="actions"><button className="primary" onClick={() => show('replenish')}><Plus size={16}/>Ingresar al mostrador</button></div>}</div>
          <Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
           <div className="table-wrap" role="region" aria-label="Tabla de control del mostrador" tabIndex={0}><table><thead><tr><th scope="col">PRODUCTO</th><th scope="col">ENTRADA</th><th scope="col">INGRESOS</th><th scope="col">STOCK AL CIERRE</th><th scope="col">VENTA CALC.</th>{waiter && <th scope="col">CORRECCIONES</th>}</tr></thead><tbody>{products.map(p => {
            const row = rows.find(r => r.productId === p.id); const input = counts[p.id]; const value = input !== undefined && input !== '' ? Number(input) : null;
            const invalid = value !== null && row && (value < 0 || !Number.isInteger(value) || value > available(row));
            const calculated = row ? displayed?.status === 'closed' ? sales(row) : value === null ? null : available(row)-value : null;
             const belowMinimum = row && (displayed?.status === 'closed' ? (row.closing ?? 0) : value ?? available(row)) < p.minimum;
             return <tr key={p.id}><td><div className="product-cell"><ProductPhoto name={p.name} category={p.category}/><div><strong>{p.name}</strong><small>Unidades{belowMinimum && <span className="stock-warning"> · Bajo el mínimo</span>}</small></div></div></td><td>{row?.opening ?? '—'}</td><td className="incoming">{row ? `+${row.incoming}` : '—'}</td><td>{active && view === 'Turno actual' && row ? <input className={invalid ? 'count invalid' : 'count'} type="number" min="0" max={available(row)} step="1" aria-label={`Stock al cierre de ${p.name}`} placeholder="Contar" value={input ?? ''} onChange={e => setCounts({ ...counts, [p.id]: e.target.value })}/> : row?.closing ?? '—'}</td><td className={invalid ? 'invalid-text' : 'sale'}>{calculated ?? '—'}</td>{waiter && <td>{row && displayed && <ShiftCorrection state={state} shift={displayed} row={row} product={p} busy={busy} onSave={command}/>}</td>}</tr>;
          })}</tbody></table>{products.length === 0 && <div className="empty">No hay productos con esa búsqueda.</div>}</div>
          <div className="table-footer"><span>{products.length} productos · Todas las cantidades en unidades</span><span>Entrada + ingresos − cierre = venta calculada{total('waste') > 0 && ` (se descuentan ${total('waste')} unidades de ajustes anteriores)`}</span></div>
          </section>
          {active && view === 'Turno actual' && waiter && <section className="closing-bar"><div><strong>Un buen cierre, un mejor comienzo.</strong><p>Cuenta los {state.products.length} productos. El cierre será la entrada del próximo turno.</p></div><label className="closing-responsible">Mozo que cierra<select value={closingResponsible} onChange={e=>setClosingResponsible(e.target.value)} required><option value="">Selecciona tu nombre</option>{WAITERS.map(name=><option key={name}>{name}</option>)}</select></label><span className="count-progress">{counted}/{state.products.length} contados</span><button className="primary" disabled={busy || counted !== state.products.length || !closingResponsible} onClick={() => { if (window.confirm('¿Cerrar el turno con estos conteos? El cierre pasará al siguiente turno. Podrás corregir el último cierre indicando un motivo.')) void command({ type: 'close', responsible:closingResponsible, counts: Object.fromEntries(Object.entries(counts).map(([k,v]) => [k, Number(v)])) }, 'Turno cerrado. El conteo quedó preparado para el próximo turno.'); }}><Check size={17}/>Cerrar turno</button></section>}
          <p className="footnote"><CircleHelp size={15}/>La venta calculada incluye las unidades pagadas por trabajadores. La conexión con caja permitirá comparar los registros.</p>
           {view === 'Historial' && <section className="panel movement-panel"><div className="panel-heading"><div><h2>Movimientos del turno</h2><p>Producción y unidades retiradas durante el turno seleccionado.</p></div></div><div className="table-wrap" role="region" aria-label="Movimientos del turno" tabIndex={0}><table><thead><tr><th>FECHA · HORA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>DETALLE / RESPONSABLE</th></tr></thead><tbody>{historicalMovements.map(m => <tr key={m.id}><td>{new Date(m.at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</td><td>{state.products.find(p => p.id === m.productId)?.name}</td><td>{m.type === 'Merma de mostrador' ? 'Ajuste histórico' : m.type}</td><td>{m.quantity}</td><td className="detail-cell">{m.note || '—'}<small>{m.responsible}</small></td></tr>)}</tbody></table>{!historicalMovements.length && <div className="empty">{historyId ? 'Este turno no tiene movimientos asociados.' : 'Selecciona un cierre para consultar sus movimientos.'}</div>}</div></section>}
           {view === 'Historial' && unassignedMovements.length > 0 && <details className="panel legacy-movements"><summary>Movimientos sin turno asociado ({unassignedMovements.length})</summary><p className="legacy-note">Incluye producción fuera de turno y registros previos a esta versión. No se asignan automáticamente para evitar atribuciones incorrectas.</p><div className="table-wrap" role="region" aria-label="Movimientos sin turno asociado" tabIndex={0}><table><thead><tr><th>FECHA · HORA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>DETALLE / RESPONSABLE</th></tr></thead><tbody>{unassignedMovements.slice(0, 100).map(m => <tr key={m.id}><td>{new Date(m.at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td><td>{state.products.find(p => p.id === m.productId)?.name}</td><td>{m.type === 'Merma de mostrador' ? 'Ajuste histórico' : m.type}</td><td>{m.quantity}</td><td className="detail-cell">{m.note || '—'}<small>{m.responsible}</small></td></tr>)}</tbody></table></div></details>}
        </>}
        {view === 'Reserva congelada' && reserveMode === 'produccion' && <>
          <div className="section-intro"><Snowflake size={19}/><span>Producción disponible por unidades. Cada unidad retirada ingresa como una unidad al mostrador.</span></div>
          <section className="panel"><Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
            <div className="reserve-grid">{products.map(p => {
              const productLots = state.lots.filter(l => l.productId === p.id && l.quantity > 0).sort((a,b) => a.producedAt.localeCompare(b.producedAt));
              const quantity = productLots.reduce((n,l) => n+l.quantity,0);
              return <article className="reserve-card" key={p.id}>
                <div className="reserve-top"><ProductPhoto name={p.name} category={p.category}/><span className={quantity ? 'pill green' : 'pill'}>{quantity ? 'En producción' : 'Sin stock'}</span></div>
                <h3>{p.name}</h3><div className="reserve-number">{quantity}<span>unidades disponibles</span></div>
                <p>{p.category === 'Postres' ? 'Listas para retirar al mostrador' : 'Listas para hornear'}</p>
                <div className="lot-list">{productLots.length ? productLots.map(l => <div key={l.id}><span>{fmt(l.producedAt)}<small>Lote {l.id.slice(0,8)}{l.responsible ? ` · Cocina: ${l.responsible}` : ''}{l.note ? ` · ${l.note}` : ''}</small></span><strong>{l.quantity}</strong></div>) : <span>No hay lotes disponibles.</span>}</div>
                <button className="secondary full" disabled={!quantity || !active || !waiter} onClick={() => show('replenish',p.id)}>Ingresar al mostrador<ArrowUpRight size={16}/></button>
              </article>;
            })}</div>
          </section><p className="footnote">{active ? 'Cada retiro se registra en el turno abierto.' : 'Abre un turno para retirar unidades de producción.'}</p>
        </>}
        {view === 'Productos' && <>
          <section className="panel"><div className="panel-heading"><div><h2>Catálogo de productos</h2><p>Todos los productos se cuentan por unidades. Ajusta los nombres y mínimos.</p></div><span className="pill">{state.products.length} productos</span></div>
            <Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
            <div className="table-wrap" role="region" aria-label="Catálogo de productos" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>MÍNIMO MOSTRADOR</th><th>MÍNIMO RESERVA</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.category}</td><td>{p.minimum} unidades</td><td>{p.reserveMinimum ?? 'Sin definir'}</td><td><button className="text-button" onClick={() => show('product',p.id)}>Editar<ChevronRight size={15}/></button></td></tr>)}</tbody></table>{!products.length && <div className="empty">No hay productos con esa búsqueda.</div>}</div>
          </section>
        </>}
        </>}
         <footer className="page-footer"><BrandLogo className="footer-logo"/><span>Hecho para cuidar cada detalle.</span>{admin && storage === 'json' && <button className="text-button" disabled={!state} onClick={() => show('restore')}>Restaurar respaldo</button>}<span>Inventario · Beta 0.2</span></footer>
      </div>
    </main>
    {modal && state && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">LUNE · INVENTARIO</div><h2 id="modal-title">{modal === 'open' ? 'Abrir un nuevo turno' : modal === 'produce' ? 'Registrar producción' : modal === 'replenish' ? 'Ingresar al mostrador' : modal === 'createProduct' ? 'Añadir producto' : modal === 'restore' ? 'Restaurar respaldo' : 'Editar producto'}</h2></div><button className="icon-button" disabled={busy} onClick={() => setModal(null)} aria-label="Cerrar formulario"><X size={20}/></button></div>
      <form onSubmit={modal === 'restore' ? restoreData : submit} key={`${modal}-${modal === 'product' ? selected : ''}`}>
      {modal === 'restore' ? <><p className="form-note">Importa un archivo JSON exportado por esta aplicación. Se validará antes de reemplazar todos los datos; exporta primero un respaldo del estado actual.</p><label>Archivo de respaldo<input type="file" accept=".json,application/json" required onChange={e => setRestoreFile(e.target.files?.[0] ?? null)}/></label></> : modal === 'open' ? <><div className="form-grid"><label>Fecha<input required name="date" type="date" max={limaDate()} defaultValue={limaDate()}/></label><label>Turno<select name="period" defaultValue={latest?.period === 'Mañana' && latest.date === limaDate() ? 'Tarde' : 'Mañana'}><option>Mañana</option><option>Tarde</option></select></label></div><label>Mozo responsable del turno<select required name="responsible" defaultValue=""><option value="" disabled>Selecciona un mozo</option>{WAITERS.map(name => <option key={name} value={name}>{name}</option>)}</select></label><p className="form-note">Este responsable quedará asociado al área de mostrador. El personal de cocina registra la producción por separado.</p>{latest ? <div className="form-note">La entrada se tomará del cierre de {latest.period.toLowerCase()} del {fmt(latest.date)}. Revisa el conteo antes de continuar.</div> : <><div className="form-note">Primer turno: registra las unidades que ya existen en el mostrador. Puedes dejar en cero los productos sin stock.</div><div className="initial-counts">{state.products.map(p => <label key={p.id}>{p.name}<input type="number" name={`initial:${p.id}`} min="0" max="100000" step="1" defaultValue="0" required/></label>)}</div></>}</> : modal === 'createProduct' ? <>
        <label>Nombre del producto<input name="name" required maxLength={100} placeholder="Nombre del postre"/></label>
        <label>Categoría<select name="category" value={newCategory} onChange={e => setNewCategory(e.target.value)}><option>Postres</option><option>Viennoiserie</option></select></label>
        <label>Mínimo en mostrador (unidades)<input name="minimum" type="number" min="0" max="100000" step="1" required defaultValue="1"/></label>
        <label>Mínimo en reserva congelada (opcional)<input name="reserveMinimum" type="number" min="0" max="100000" step="1" placeholder="Sin definir"/></label>
        <p className="form-note">Si hay un turno abierto, el producto se incorpora con entrada inicial en cero. Se cuenta por unidades.</p>
      </> : modal === 'product' ? <>
        <label>Nombre del producto<input name="name" required defaultValue={chosen?.name} maxLength={100}/></label>
        <label>Mínimo en mostrador (unidades)<input name="minimum" type="number" min="0" max="100000" step="1" required defaultValue={chosen?.minimum}/></label>
        <label>Mínimo en reserva congelada (opcional)<input name="reserveMinimum" type="number" min="0" max="100000" step="1" defaultValue={chosen?.reserveMinimum ?? ''} placeholder="Sin definir"/></label>
        <p className="form-note">Cada unidad retirada de producción suma una unidad al mostrador.</p>
      </> : <>
      <label>Producto<select name="productId" value={selected} onChange={e => setSelected(e.target.value)}>{state.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {modal === 'produce' && <><div className="form-grid"><label>Cantidad producida (unidades)<input required name="quantity" type="number" min="1" max="100000" step="1" placeholder="Ej. 4"/></label><label>Fecha de producción<input required name="date" type="date" max={limaDate()} defaultValue={limaDate()}/></label></div><label>Cocinero responsable<select required name="responsible" defaultValue=""><option value="" disabled>Selecciona un cocinero</option>{COOKS.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Nota del lote (opcional)<input name="note" maxLength={180} placeholder="Referencia del táper o ubicación"/></label><p className="form-note">Registra al cocinero que preparó el lote. Su nombre quedará guardado como responsable de esta producción. La producción queda en reserva hasta registrar el retiro.</p></>}
      {modal === 'replenish' && <>
        <label>Mozo que ingresa los productos al mostrador<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{WAITERS.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Lote de origen · selección automática<input readOnly value={oldestLot ? `${fmt(oldestLot.producedAt)} · ${oldestLot.quantity} unidades disponibles · ${oldestLot.id.slice(0,8)}` : 'Sin lotes disponibles'}/></label>
        <input type="hidden" name="lotId" value={oldestLot?.id ?? ''}/>
        {!oldestLot && <p className="invalid-text">No hay unidades disponibles. Registra la producción primero.</p>}
        <label>Unidades a ingresar al mostrador<input required name="quantity" type="number" min="1" max={oldestLot?.quantity ?? 0} step="1" placeholder="Ej. 5"/></label>
        <p className="form-note">Se usa primero el lote más antiguo con stock y no se puede cambiar. Cuando se agote, se seleccionará el siguiente. Para usar varios lotes, registra primero las unidades del lote seleccionado y luego realiza otro ingreso.</p>
      </>}
      </>}
      {error && <div role="alert" className="alert error">{error}</div>}
      <div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={() => setModal(null)}>Cancelar</button><button className="primary" type="submit" disabled={busy || (modal === 'replenish' && !oldestLot) || (modal === 'restore' && !restoreFile)}>{busy ? 'Guardando…' : modal === 'open' ? 'Abrir turno' : modal === 'restore' ? 'Restaurar datos' : modal === 'createProduct' ? 'Añadir producto' : 'Guardar registro'}<Check size={16}/></button></div>
      </form>
    </section></div>}
  </div>;
}
function Stat({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) { return <article className="stat"><div><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}<small>uds.</small></strong><p>{detail}</p></article>; }
function Toolbar({ filter, setFilter, query, setQuery }: { filter: string; setFilter: (v: string) => void; query: string; setQuery: (v: string) => void }) { return <div className="toolbar"><div className="tabs">{['Todos', 'Postres', 'Viennoiserie'].map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><input type="search" placeholder="Buscar producto…" aria-label="Buscar producto" value={query} onChange={e => setQuery(e.target.value)}/></div>; }

function ProductPhoto({ name, category }: { name: string; category: string }) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const photo = normalized === 'pastel de queso japones' ? '/images/pastel-queso-japones.png' : normalized === 'delicia multifloral' ? '/images/delicia-multifloral.png' : null;
  return photo ? <img className="product-photo" src={photo} alt={name}/> : <span className={category === 'Postres' ? 'product-icon' : 'product-icon bread'}>{category === 'Postres' ? <CakeSlice size={19}/> : <Croissant size={19}/>}</span>;
}
