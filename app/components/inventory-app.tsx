'use client';
import {isKitchenProduct,bakedQuantity} from '@/lib/baking';
import {BakingWorkspace} from './baking-workspace';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LayoutDashboard, Snowflake, ClipboardList, History, Settings2, Plus, ArrowUpRight, Check, X, ChevronRight, Download, CircleHelp, Croissant, CakeSlice, RefreshCw, Menu, Boxes, SprayCan, BarChart3, Bell, Upload } from 'lucide-react';
import { available, sales, limaDate, shiftTeam, shiftLabel, type State } from '@/lib/inventory';
import { SuppliesWorkspace } from './supplies-workspace';
import { ShiftSalesCard, SalesOverview } from './sales-dashboard';
import { StockNotice, StockAlertsPanel } from './stock-alerts';
import { ExcelImportWorkspace } from './excel-import';
import { allSalesShifts } from '@/lib/excel-history';
import {BrandLogo} from './brand-logo';
import {ShiftCorrection} from './shift-correction';
import {DisplayTransfers} from './display-transfers';
import {AccountHistory} from './account-history';
import {canViewSection,type InventorySection} from '@/lib/inventory-visibility';
import {OperationDialog,isOperationKind,type OperationKind} from './operation-dialog';
import {useClosingDraft} from '@/app/hooks/use-closing-draft';
import {CloseShiftDialog,closingFingerprint} from './close-shift-dialog';

import {closingCounts,displayQuantity,productDeletionReason,reserveQuantity} from '@/lib/catalog';
import {ManualCountInput} from './manual-count-input';
import {CatalogActions} from './catalog-actions';
type View = InventorySection;
type Modal = OperationKind | 'product' | 'createProduct' | 'restore' | null;
const icons = { 'Turno actual': LayoutDashboard, 'Reserva congelada': Snowflake, Horneados:Croissant, Historial: History, Productos: Settings2, 'Insumos y bebidas': Boxes, Limpieza: SprayCan, 'Ventas por turno': BarChart3, 'Salidas al mostrador':ArrowUpRight, 'Alertas de inventario':Bell, 'Importar Excel':Upload };
const fmt = (date: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' }).format(new Date(`${date}T12:00:00-05:00`));

import type { Actor } from '@/lib/access';
export default function Home({actor}:{actor:Actor}) {
  const admin=actor.role==='admin',cook=admin||actor.role==='cocina',waiter=admin||actor.role==='mozo';
  async function logout(){
    if(busy||closingBusy||closeConfirmation)return;
    setClosingBusy(true);
    try{
      if(waiter&&active&&!(await draft.flush())){setError('No se pudo guardar el conteo pendiente. Revisa el aviso antes de cerrar sesión.');return;}
      const r=await fetch('/api/auth/logout',{method:'POST'});
      if(r.ok)window.location.assign('/login');else setError('No se pudo cerrar la sesión. Reintenta.');
    }catch{setError('No se pudo cerrar la sesión. Tus conteos pendientes permanecen guardados en este navegador.');}
    finally{setClosingBusy(false);}
  }
  const [state, setState] = useState<State | null>(null);
  const [storage, setStorage] = useState('json');
  const [backupStatus,setBackupStatus]=useState('');
  const [reserveMode, setReserveMode] = useState<'produccion' | 'frutas'>('produccion');
  const [view, setView] = useState<View>(actor.role==='cocina'?'Reserva congelada':'Turno actual');
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState('p1');
  const [filter, setFilter] = useState('Todos');
  const [query, setQuery] = useState('');
  const [showInactive,setShowInactive]=useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyId, setHistoryId] = useState('');
  const [closingBusy,setClosingBusy]=useState(false);
  const [closeConfirmation,setCloseConfirmation]=useState<{shiftId:string;counts:Record<string,string>}|null>(null);
  const interactionLocked=busy||closingBusy||closeConfirmation!==null;
  const [mobile, setMobile] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [newCategory, setNewCategory] = useState('Postres');
  const busyRef = useRef(busy);
  busyRef.current = interactionLocked;
  const modalRef=useRef(modal); modalRef.current=modal;
  async function refresh() {
    try { const response = await fetch('/api/inventory', { cache: 'no-store' }); const result = await response.json(); if(response.status===401){window.location.assign('/login');return;} if(response.status===428){window.location.assign('/cuenta');return;} if (!response.ok) throw new Error(result.error || 'No se pudo cargar el inventario.'); setState(previous=>!previous||result.revision>=previous.revision?result:previous); setStorage(response.headers.get('X-Inventory-Storage') || 'json'); setBackupStatus(response.headers.get('X-Shift-Backups')||'');setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); const timer=setInterval(()=>{if(!busyRef.current&&!modalRef.current&&document.visibilityState==='visible')void refresh();},30000); return ()=>clearInterval(timer); }, []);
  async function command(data: Record<string, unknown>, message: string) {
    if (!state || busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, revision: state.revision }) });
      const result = await response.json();
      if (!response.ok) {
        if(typeof result.error==='string'&&result.error.includes('Los datos cambiaron'))await refresh();
        throw new Error(result.error || 'No se pudo guardar.');
      }
      setState(previous=>!previous||result.revision>=previous.revision?result:previous);setBackupStatus(response.headers.get('X-Shift-Backups')||''); setNotice(message); setModal(null);
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const rawActive=state?.shifts.find(s=>s.status==='open');
  const active=rawActive&&state?{...rawActive,rows:rawActive.rows.filter(row=>!isKitchenProduct(state.products.find(p=>p.id===row.productId)!))}:rawActive;
  useEffect(()=>{if(closeConfirmation&&closeConfirmation.shiftId!==active?.id)setCloseConfirmation(null);},[active?.id,closeConfirmation]);
  const draft=useClosingDraft(active?.id,waiter,actor.id);
  const counts=closingCounts(active?.rows??[],draft.counts);
  const latest = state?.shifts.at(-1);
  const historyShifts=state?allSalesShifts(state):[];
  const displayed = view === 'Historial' ? historyShifts.find(s => s.id === historyId) : active ?? latest;
  const products = state?.products.filter(p => (view!=='Turno actual'||!isKitchenProduct(p))&&(view==='Productos'?(p.active!==false||admin&&showInactive):view==='Turno actual'||view==='Historial'?!!displayed?.rows.some(row=>row.productId===p.id):p.active!==false||!!state&&reserveQuantity(state,p.id)>0) && (filter === 'Todos' || p.category === filter) && p.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const chosen = state?.products.find(p => p.id === selected);
  const rows = displayed?.rows ?? [];
  const historicalMovements = state?.movements.filter(m => m.shiftId === historyId).slice(0, 100) ?? [];
  const unassignedMovements = state?.movements.filter(m => !m.shiftId) ?? [];
  const total = (key: 'opening' | 'incoming' | 'waste') => rows.reduce((n, r) => n + r[key], 0);
  const counted = active?.rows.filter(r => counts[r.productId] !== undefined && counts[r.productId] !== '').length ?? 0;
  const validCounts=!!active&&active.rows.every(row=>{const raw=counts[row.productId];const value=Number(raw);return raw!==undefined&&raw!==''&&Number.isSafeInteger(value)&&value>=0&&value<=available(row);});
  const draftLabel={loading:'Cargando conteos…',saved:'Guardado',saving:'Guardando…',pending:'Pendiente de guardar',conflict:'Hay conteos por revisar',error:'No se pudo guardar'}[draft.status];
  async function closeShift(){
    if(!active||busy||closingBusy||closeConfirmation)return;
    setClosingBusy(true);setError('');
    try{
      if(!await draft.flush()){setError('Primero guarda o revisa los conteos pendientes.');return;}
      const savedSnapshot=draft.getSnapshot();
      const snapshot={...savedSnapshot,counts:closingCounts(active.rows,savedSnapshot.counts)};
      if(!active.rows.every(row=>{const raw=snapshot.counts[row.productId];const value=Number(raw);return raw!==undefined&&raw!==''&&Number.isSafeInteger(value)&&value>=0&&value<=available(row);})){setError('Completa los conteos pendientes y revisa las cantidades antes de cerrar.');return;}
      setCloseConfirmation({shiftId:active.id,counts:{...snapshot.counts}});
    }finally{setClosingBusy(false);}
  }
  async function confirmCloseShift(){
    if(!closeConfirmation||busy||closingBusy)return;
    if(!active||active.id!==closeConfirmation.shiftId){setCloseConfirmation(null);setError('El turno cambió. Actualiza los datos antes de continuar.');return;}
    setClosingBusy(true);setError('');
    try{
      if(!await draft.flush()){setError('Hay conteos pendientes de guardar o revisar. Vuelve al conteo para resolverlos.');return;}
      const savedSnapshot=draft.getSnapshot();
      const snapshot={...savedSnapshot,counts:closingCounts(active.rows,savedSnapshot.counts)};
      if(!active.rows.every(row=>{const raw=snapshot.counts[row.productId];const value=Number(raw);return raw!==undefined&&raw!==''&&Number.isSafeInteger(value)&&value>=0&&value<=available(row);})){setError('Hay cantidades pendientes o por revisar. Vuelve al conteo antes de cerrar.');return;}
      if(closingFingerprint(active,snapshot.counts)!==closingFingerprint(active,closeConfirmation.counts)){
        setCloseConfirmation({shiftId:active.id,counts:{...snapshot.counts}});setError('Los conteos se actualizaron desde otra sesión. Revisa el nuevo resumen antes de confirmar.');return;
      }
      if(await command({type:'close',counts:Object.fromEntries(active.rows.map(row=>[row.productId,Number(snapshot.counts[row.productId])])),draftVersions:snapshot.versions},'Turno cerrado. El conteo quedó preparado para el próximo turno.'))setCloseConfirmation(null);
    }finally{setClosingBusy(false);}
  }
  function show(kind: Modal, id?: string) { setError(''); setRestoreFile(null); setNewCategory('Postres'); setSelected(id ?? state?.products[0]?.id ?? 'p1'); setModal(kind); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    for (const key of ['quantity', 'minimum']) if (key in data) (data as Record<string, unknown>)[key] = Number(data[key]);
    if('reserveMinimum' in data) (data as Record<string,unknown>).reserveMinimum=data.reserveMinimum===''?null:Number(data.reserveMinimum);
    void command({ ...data, type: modal, ...(modal === 'product' ? { productId: selected } : {}) }, modal === 'createProduct' ? 'Producto agregado al catálogo.' : 'Producto actualizado.');
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
      setState(result); setHistoryId(''); setModal(null); setNotice('Respaldo restaurado correctamente.');
    } catch (e) { setError(e instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!modal || isOperationKind(modal)) return;
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
  const reportViews:View[]=['Historial','Ventas por turno','Salidas al mostrador','Alertas de inventario','Importar Excel'];
  const visibleViews=(Object.keys(icons) as View[]).filter(item=>canViewSection(actor.role,item));
  const navigationButton=(item:View)=>{
    const Icon=icons[item];
    return <button className={view===item?'nav-item active':'nav-item'} key={item} disabled={interactionLocked} onClick={()=>{setView(item);setMobile(false);setFilter('Todos');setQuery('');if(item==='Historial')setHistoryId(admin?historyShifts.filter(shift=>shift.status==='closed').at(-1)?.id??'':'');}}><Icon size={19}/>{item}{view===item&&<ChevronRight size={15}/>}</button>;
  };
  return <div className="shell">
    <aside className={mobile ? 'sidebar expanded' : 'sidebar'}>
      <a className="brand" href="/" aria-label="Lune Alta Pastelería · Inicio"><BrandLogo/></a>
      <div className="workspace"><span className="workspace-icon">L</span><div>Lune · Arequipa<small>Gestión de inventario</small></div><span className="beta">BETA</span></div>
      <p className="nav-label">ESPACIO DE TRABAJO</p>
      <nav>{visibleViews.filter(item=>!reportViews.includes(item)).map(navigationButton)}<details className="nav-report-group" open={reportViews.includes(view)||undefined}><summary>Reportes y consultas</summary>{visibleViews.filter(item=>reportViews.includes(item)).map(navigationButton)}</details></nav>
      <div className="sidebar-bottom"><span className="avatar">L</span><div>{actor.name}<small>{actor.role}</small></div><span className="online" /></div>
    </aside>
    <main>
      <header className="topbar"><div><button className="mobile-menu icon-button" onClick={() => setMobile(!mobile)} aria-label={mobile ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={mobile}><Menu size={20}/></button><span>Inventario</span><ChevronRight size={14}/><strong>{view}</strong></div><span className="local-status"><span className="online"/>{storage === 'supabase' ? 'Supabase' : storage === 'postgres' ? 'PostgreSQL local' : 'Beta local'}</span></header>
      <div className="content"><div className="account-strip"><span>{actor.name} · {actor.role}</span><a href="/cuenta">Mi contraseña</a>{admin&&<><a href="/admin/usuarios">Equipo y permisos</a><a href="/admin/respaldos">Respaldos</a></>}<button className="text-button" disabled={interactionLocked} onClick={logout}>Cerrar sesión</button></div>
         <div className="heading"><div><div className="eyebrow">EL DETALLE HACE LA DIFERENCIA</div><h1>{view}</h1><p>{view === 'Turno actual' ? 'Cada unidad cuenta. Lleva el control de tu mostrador.' : view === 'Reserva congelada' ? 'Tu próxima reposición empieza aquí.' : view === 'Salidas al mostrador' ? 'Consulta los productos ingresados desde reserva por fecha y turno.' : view === 'Historial' ? 'Cada turno y cada movimiento, en un solo lugar.' : 'El catálogo que da forma a tu inventario.'}</p></div><div className="heading-actions"><button className="icon-button" disabled={interactionLocked} onClick={refresh} aria-label="Actualizar datos"><RefreshCw size={18}/></button>{view === 'Reserva congelada' && cook && reserveMode === 'produccion' && cook ? <button className="primary" disabled={interactionLocked||!state} onClick={() => show('produce')}><Plus size={17}/>Agregar producción</button> : view === 'Turno actual' && !active && waiter ? <button className="primary" disabled={interactionLocked||!state} onClick={() => show('open')}><Plus size={17}/>Abrir turno</button> : view === 'Productos' && admin ? <button className="primary" disabled={interactionLocked||!state} onClick={() => show('createProduct')}><Plus size={17}/>Nuevo producto</button> : admin && <button className="secondary" disabled={interactionLocked||!state} onClick={exportData}><Download size={16}/>Exportar respaldo</button>}</div></div>
        <div className="demo-banner"><span className="demo-dot"/>Beta 0.2 · Postres por unidades, frutas por porciones e insumos por presentación. Registra conteos iniciales y mínimos reales.</div>
        {error && <div role="alert" className="alert error">{error}<button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
        {backupStatus==='pending'&&<div role="status" className="alert">Hay un respaldo pendiente de envío. El cierre está guardado y la copia se reintentará automáticamente.{admin&&<> <a href="/admin/respaldos">Revisar respaldos</a></>}</div>}
        {backupStatus==='unavailable'&&admin&&<div role="alert" className="alert error">No se pudo comprobar el estado de los respaldos. Revisa la configuración antes del próximo cierre. <a href="/admin/respaldos">Ver respaldos</a></div>}
         {notice && <div role="status" className="alert success"><Check size={17}/>{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
        {state&&<StockNotice state={state} onOpen={()=>setView('Alertas de inventario')}/>}
        {!state ? <div className="empty">Cargando inventario… {error && <button onClick={refresh}>Reintentar</button>}</div> : <>
        {view === 'Reserva congelada' && cook && <div className="reserve-mode tabs" aria-label="Tipo de reserva"><button className={reserveMode==='produccion'?'selected':''} onClick={()=>setReserveMode('produccion')}>Postres y bollería</button><button className={reserveMode==='frutas'?'selected':''} onClick={()=>setReserveMode('frutas')}>Frutas por porciones</button></div>}
        {view === 'Reserva congelada' && cook && reserveMode === 'frutas' && <SuppliesWorkspace actor={actor} key="frutas" state={state} groups={['Frutas congeladas']} busy={interactionLocked} error={error} onCommand={command}/>}
        {view === 'Insumos y bebidas' && <SuppliesWorkspace actor={actor} key="insumos" state={state} groups={['Insumos','Bebidas','Empaques','Papelería','Preparados líquidos','Cocina']} busy={interactionLocked} error={error} onCommand={command}/>}
        {view === 'Limpieza' && <SuppliesWorkspace actor={actor} key="limpieza" state={state} groups={['Limpieza']} busy={interactionLocked} error={error} onCommand={command}/>}
        {view==='Horneados'&&cook&&<BakingWorkspace state={state} busy={interactionLocked} error={error} onCommand={command}/>}
        {view === 'Ventas por turno' && waiter && <SalesOverview state={state} counts={counts}/>}
        {view === 'Salidas al mostrador' && cook && <DisplayTransfers state={state}/>}
        {view === 'Alertas de inventario' && <StockAlertsPanel state={state}/>}
        {view === 'Importar Excel' && <ExcelImportWorkspace state={state} busy={interactionLocked} onCommand={command}/>}
        {view==='Historial'&&<AccountHistory actor={actor} revision={state.revision} onReviewShift={waiter?setHistoryId:undefined}/>}
        {(view === 'Turno actual' || view === 'Historial'&&(admin||waiter&&!!historyId)) && <>
          {view==='Turno actual'&&active&&<div className="team-strip"><div><strong>Equipo del turno · {shiftTeam(active).length}/4 mozos</strong><p>{shiftLabel(active)}</p></div>{waiter&&<div className="actions"><button className="secondary" disabled={interactionLocked} onClick={()=>show('replaceWaiter')}>Cambiar mozo</button><button className="secondary" disabled={interactionLocked||shiftTeam(active).length>=4} onClick={()=>show('addWaiters')}><Plus size={16}/>Agregar más mozos</button></div>}</div>}
          {view==='Turno actual'&&waiter&&draft.conflicts.length>0&&<section className="draft-conflicts" aria-label="Conteos pendientes de revisión"><strong>Hay cambios desde otra sesión</strong><p>Elige qué cantidad conservar antes de cerrar el turno.</p>{draft.conflicts.map(conflict=><div className="draft-conflict-item" key={conflict.productId}><span><strong>{state.products.find(product=>product.id===conflict.productId)?.name}</strong><br/>Este navegador: {conflict.localValue||'Sin contar'} · Guardado: {conflict.remoteValue||'Sin contar'}</span><div className="actions"><button className="secondary" disabled={interactionLocked} onClick={()=>draft.resolveConflict(conflict.productId,'remote')}>Usar guardado</button><button className="secondary" disabled={interactionLocked} onClick={()=>draft.resolveConflict(conflict.productId,'local')}>Conservar este conteo</button></div></div>)}</section>}
          <div className="stats"><Stat label="ENTRADA DEL TURNO" value={total('opening')} detail="Unidades recibidas" icon={<ClipboardList size={19}/>}/><Stat label="INGRESOS AL MOSTRADOR" value={total('incoming')} detail="Unidades ingresadas al mostrador" icon={<ArrowUpRight size={20}/>}/><Stat label={displayed?.status === 'closed' ? 'VENTA CALCULADA' : 'DISPONIBLE ANTES DEL CONTEO'} value={displayed?.status === 'closed' ? rows.reduce((n,r) => n + (sales(r) ?? 0),0) : rows.reduce((n,r) => n + available(r),0)} detail={displayed?.status === 'closed' ? 'Según movimiento físico' : 'Aún no descuenta ventas'} icon={<CakeSlice size={20}/>}/></div>
          <ShiftSalesCard shift={displayed} products={state.products} counts={counts}/>
          {view === 'Historial' && admin && <label className="history-picker">Consultar turno<select value={historyId} onChange={e => setHistoryId(e.target.value)}><option value="">Selecciona un cierre</option>{historyShifts.filter(s => s.status === 'closed').toReversed().map(s => <option key={s.id} value={s.id}>{s.date} · {s.period} · {shiftLabel(s)}</option>)}</select></label>}
          {view==='Historial'&&displayed?.id.startsWith('excel:')&&<p className="alert warning">Archivo histórico de Excel. Solo muestra los postres importados y no modifica el saldo del mostrador ni la reserva actual.</p>}
          <section className="panel"><div className="panel-heading"><div><h2>Control del mostrador <span className={active && view === 'Turno actual' ? 'pill green' : 'pill'}>{active && view === 'Turno actual' ? 'En curso' : displayed ? 'Cerrado' : 'Sin turno'}</span></h2><p>{displayed ? `${fmt(displayed.date)} · Turno ${displayed.period.toLowerCase()} · Responsables: ${shiftLabel(displayed)}` : 'Abre el primer turno e ingresa el conteo inicial del mostrador.'}</p></div>{active && view === 'Turno actual' && waiter && <div className="actions"><button className="primary" disabled={interactionLocked} onClick={() => show('replenish')}><Plus size={16}/>Ingresar al mostrador</button></div>}</div>
          <Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
           <div className="table-wrap" role="region" aria-label="Tabla de control del mostrador" tabIndex={0}><table><thead><tr><th scope="col">PRODUCTO</th><th scope="col">ENTRADA</th><th scope="col">INGRESOS</th><th scope="col">SALIDA</th><th scope="col">VENTA CALC.</th>{waiter && <th scope="col">CORRECCIONES</th>}</tr></thead><tbody>{products.map(p => {
            const row = rows.find(r => r.productId === p.id); const input = counts[p.id]; const value = input !== undefined && input !== '' ? Number(input) : null;
            const invalid = value !== null && row && (value < 0 || !Number.isInteger(value) || value > available(row));
            const calculated = row ? displayed?.status === 'closed' ? sales(row) : value === null ? null : available(row)-value : null;
             const belowMinimum = row && (displayed?.status === 'closed' ? (row.closing ?? 0) : value ?? available(row)) < p.minimum;
             return <tr key={p.id}><td><div className="product-cell"><ProductPhoto name={p.name} category={p.category}/><div><strong>{p.name}</strong><small>Unidades{belowMinimum && <span className="stock-warning"> · Bajo el mínimo</span>}</small></div></div></td><td>{row?.opening ?? '—'}</td><td className="incoming">{row ? `+${row.incoming}` : '—'}</td><td>{active && view === 'Turno actual' && waiter && row ? <ManualCountInput min={0} max={available(row)} step={1} className={invalid ? 'count invalid' : 'count'} aria-label={`Salida de ${p.name}`} title={displayQuantity(row)===0?'Sin unidades en el mostrador':'Unidades que quedan al terminar el turno'} disabled={interactionLocked||displayQuantity(row)===0} placeholder="Contar" value={input ?? ''} onChange={e => draft.setCount(p.id,e.target.value)}/> : row?.closing ?? '—'}</td><td className={invalid ? 'invalid-text' : 'sale'}>{calculated ?? '—'}</td>{waiter && <td>{row && displayed && <ShiftCorrection state={state} shift={displayed} row={row} product={p} busy={interactionLocked} onSave={command}/>}</td>}</tr>;
          })}</tbody></table>{products.length === 0 && <div className="empty">No hay productos con esa búsqueda.</div>}</div>
          <div className="table-footer"><span>{products.length} productos · Todas las cantidades en unidades</span><span>Entrada + ingresos − salida = venta calculada{total('waste') > 0 && ` (se descuentan ${total('waste')} unidades de ajustes anteriores)`}</span></div>
          </section>
          {active && view === 'Turno actual' && waiter && <section className="closing-bar"><div><strong>Cuenta y cierra el turno.</strong><p>Los conteos se guardan automáticamente, aunque cierres sesión.</p><p className={`draft-status ${draft.status}`} role="status" aria-live="polite">{draftLabel}</p>{draft.error&&<p className="invalid-text">{draft.error}</p>}</div><div className="closing-team"><strong>Responsables</strong><br/>{shiftLabel(active)}</div><span className="count-progress">{counted}/{active.rows.length} contados</span><button className="primary" disabled={interactionLocked||!validCounts||draft.status==='loading'||draft.conflicts.length>0} onClick={()=>void closeShift()}><Check size={17}/>{closingBusy?'Guardando…':'Cerrar turno'}</button></section>}
          <p className="footnote"><CircleHelp size={15}/>La venta calculada incluye las unidades pagadas por trabajadores. La conexión con caja permitirá comparar los registros.</p>
           {view === 'Historial' && admin && <section className="panel movement-panel"><div className="panel-heading"><div><h2>Movimientos del turno</h2><p>Producción y unidades retiradas durante el turno seleccionado.</p></div></div><div className="table-wrap" role="region" aria-label="Movimientos del turno" tabIndex={0}><table><thead><tr><th>FECHA · HORA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>DETALLE / RESPONSABLE</th></tr></thead><tbody>{historicalMovements.map(m => <tr key={m.id}><td>{new Date(m.at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</td><td>{state.products.find(p => p.id === m.productId)?.name}</td><td>{m.type === 'Merma de mostrador' ? 'Ajuste histórico' : m.type}</td><td>{m.quantity}</td><td className="detail-cell">{m.note || '—'}<small>{m.responsibles?.join(', ')??m.responsible}</small></td></tr>)}</tbody></table>{!historicalMovements.length && <div className="empty">{historyId ? 'Este turno no tiene movimientos asociados.' : 'Selecciona un cierre para consultar sus movimientos.'}</div>}</div></section>}
           {view === 'Historial' && admin && unassignedMovements.length > 0 && <details className="panel legacy-movements"><summary>Movimientos sin turno asociado ({unassignedMovements.length})</summary><p className="legacy-note">Incluye producción fuera de turno y registros previos a esta versión. No se asignan automáticamente para evitar atribuciones incorrectas.</p><div className="table-wrap" role="region" aria-label="Movimientos sin turno asociado" tabIndex={0}><table><thead><tr><th>FECHA · HORA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>DETALLE / RESPONSABLE</th></tr></thead><tbody>{unassignedMovements.slice(0, 100).map(m => <tr key={m.id}><td>{new Date(m.at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td><td>{state.products.find(p => p.id === m.productId)?.name}</td><td>{m.type === 'Merma de mostrador' ? 'Ajuste histórico' : m.type}</td><td>{m.quantity}</td><td className="detail-cell">{m.note || '—'}<small>{m.responsibles?.join(', ')??m.responsible}</small></td></tr>)}</tbody></table></div></details>}
        </>}
        {view === 'Reserva congelada' && cook && reserveMode === 'produccion' && <>
          <div className="section-intro"><Snowflake size={19}/><span>Producción disponible por unidades. Los postres ingresan al mostrador; la bollería pasa primero por Horneados.</span></div>
          <section className="panel"><Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
            <div className="reserve-grid">{products.map(p => {
              const productLots = state.lots.filter(l => l.productId === p.id && l.quantity > 0).sort((a,b) => a.producedAt.localeCompare(b.producedAt));
              const quantity = productLots.reduce((n,l) => n+l.quantity,0);
              return <article className="reserve-card" key={p.id}>
                <div className="reserve-top"><ProductPhoto name={p.name} category={p.category}/><span className={quantity ? 'pill green' : 'pill'}>{quantity ? 'En producción' : 'Sin stock'}</span></div>
                <h3>{p.name}</h3><div className="reserve-number">{quantity}<span>unidades disponibles</span></div>
                <p>{p.category === 'Postres' ? 'Listas para retirar al mostrador' : 'Listas para hornear'}</p>
                {cook&&<details className="production-details"><summary>Ver producción registrada</summary><div className="lot-list">{productLots.length?productLots.map(l=><div key={l.id}><span>{fmt(l.producedAt)}<small>{l.responsible?`Cocina: ${l.responsible}`:''}</small></span><strong>{l.quantity} uds.</strong></div>):<span>No hay producción disponible.</span>}</div></details>}
                <div className="reserve-actions">{waiter&&!isKitchenProduct(p)&&<button className="secondary full" disabled={interactionLocked||!(p.category==='Bollería'?bakedQuantity(state,p.id):quantity)||!active} onClick={()=>show('replenish',p.id)}>Ingresar al mostrador<ArrowUpRight size={16}/></button>}{cook&&<button className="text-button" disabled={interactionLocked||!state.lots.some(l=>l.productId===p.id)} onClick={()=>show('correctProduction',p.id)}>Corregir registro<ChevronRight size={15}/></button>}</div>
              </article>;
            })}</div>
          </section><p className="footnote">{!waiter?'Registra la producción y consulta las salidas al mostrador.':active ? 'Cada retiro se registra en el turno abierto.' : 'Abre un turno para retirar unidades de producción.'}</p>
        </>}
        {view === 'Productos' && <>
          <section className="panel"><div className="panel-heading"><div><h2>Catálogo de productos</h2><p>Todos los productos se cuentan por unidades. Ajusta los nombres, mínimos y disponibilidad.</p></div><label className="check-label"><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>Mostrar desactivados</label></div>
            <Toolbar filter={filter} setFilter={setFilter} query={query} setQuery={setQuery}/>
            <div className="table-wrap" role="region" aria-label="Catálogo de productos" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>MÍNIMO MOSTRADOR</th><th>MÍNIMO RESERVA</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td><strong>{p.name}</strong>{p.active===false&&<span className="pill">Desactivado</span>}</td><td>{p.category}</td><td>{p.minimum} unidades</td><td>{p.reserveMinimum ?? 'Sin definir'}</td><td><div className="catalog-actions"><button className="text-button" disabled={interactionLocked} onClick={() => show('product',p.id)}>Editar<ChevronRight size={15}/></button><CatalogActions name={p.name} active={p.active!==false} busy={interactionLocked} deleteReason={productDeletionReason(state,p.id)} onSave={command} entity="product" id={p.id}/></div></td></tr>)}</tbody></table>{!products.length && <div className="empty">No hay productos con esa búsqueda.</div>}</div>
          </section>
        </>}
        </>}
         <footer className="page-footer"><BrandLogo className="footer-logo"/><span>Hecho para cuidar cada detalle.</span>{admin && storage === 'json' && <button className="text-button" disabled={interactionLocked||!state} onClick={() => show('restore')}>Restaurar respaldo</button>}<span>Inventario · Beta 0.2</span></footer>
      </div>
    </main>
    {closeConfirmation&&active&&state&&<CloseShiftDialog shift={active} products={state.products} counts={closeConfirmation.counts} busy={busy||closingBusy} error={error} onCancel={()=>{if(!busy&&!closingBusy){setCloseConfirmation(null);setError('');}}} onConfirm={()=>void confirmCloseShift()}/>}
    {modal&&state&&isOperationKind(modal)&&<OperationDialog key={`${modal}-${selected}`} kind={modal} state={state} productId={selected} busy={interactionLocked} serverError={error} onSave={command} onClose={()=>setModal(null)}/>}
    {modal&&state&&!isOperationKind(modal)&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setModal(null);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">LUNE · INVENTARIO</div><h2 id="modal-title">{modal==='createProduct'?'Añadir producto':modal==='restore'?'Restaurar respaldo':'Editar producto'}</h2></div><button className="icon-button" disabled={busy} onClick={()=>setModal(null)} aria-label="Cerrar formulario"><X size={20}/></button></div>
      <form onSubmit={modal==='restore'?restoreData:submit} key={`${modal}-${selected}`}>
        {modal==='restore'?<><p className="form-note">Importa un respaldo JSON exportado por esta aplicación.</p><label>Archivo de respaldo<input type="file" accept=".json,application/json" required onChange={e=>setRestoreFile(e.target.files?.[0]??null)}/></label></>:<>
          <label>Nombre del producto<input name="name" required maxLength={100} defaultValue={modal==='product'?chosen?.name:''}/></label>
          {modal==='createProduct'&&<label>Categoría<select name="category" value={newCategory} onChange={e=>setNewCategory(e.target.value)}><option>Postres</option><option>Bollería</option></select></label>}
          <label>Mínimo en mostrador<ManualCountInput name="minimum" min="0" max="100000" step="1" required defaultValue={modal==='product'?chosen?.minimum:1}/></label>
          <label>Mínimo en reserva congelada (opcional)<ManualCountInput name="reserveMinimum" min="0" max="100000" step="1" defaultValue={modal==='product'?chosen?.reserveMinimum??'':''} placeholder="Sin definir"/></label>
        </>}
        {error&&<div className="alert error" role="alert">{error}</div>}
        <div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={busy||(modal==='restore'&&!restoreFile)}>{busy?'Guardando…':modal==='restore'?'Restaurar datos':'Guardar'}<Check size={16}/></button></div>
      </form>
    </section></div>}
  </div>;
}
function Stat({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) { return <article className="stat"><div><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}<small>uds.</small></strong><p>{detail}</p></article>; }
function Toolbar({ filter, setFilter, query, setQuery }: { filter: string; setFilter: (v: string) => void; query: string; setQuery: (v: string) => void }) { return <div className="toolbar"><div className="tabs">{['Todos', 'Postres', 'Bollería'].map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><input type="search" placeholder="Buscar producto…" aria-label="Buscar producto" value={query} onChange={e => setQuery(e.target.value)}/></div>; }

function ProductPhoto({ name, category }: { name: string; category: string }) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const photo = normalized === 'pastel de queso japones' ? '/images/pastel-queso-japones.png' : normalized === 'delicia multifloral' ? '/images/delicia-multifloral.png' : null;
  return photo ? <img className="product-photo" src={photo} alt={name}/> : <span className={category === 'Postres' ? 'product-icon' : 'product-icon bread'}>{category === 'Postres' ? <CakeSlice size={19}/> : <Croissant size={19}/>}</span>;
}
