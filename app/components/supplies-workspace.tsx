'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Download, X, Package, Search, ClipboardList } from 'lucide-react';
import type { State } from '@/lib/inventory';
import { SUPPLY_GROUPS, SUPPLY_UNITS, unitLabel, supplyAlert, type Supply, type SupplyGroup } from '@/lib/supplies';

import type {Actor} from '@/lib/access';
import {COOKS,WAITERS} from '@/lib/staff';
type Props = { actor:Actor; state: State; groups: readonly SupplyGroup[]; busy: boolean; error: string; onCommand: (data: Record<string,unknown>, message: string) => Promise<boolean | undefined> };
type FormMode = 'create' | 'edit' | 'entrada' | 'salida' | 'conteo';
const localTime = (at: string) => new Date(at).toLocaleString('es-PE',{timeZone:'America/Lima'});

export function SuppliesWorkspace({ actor, state, groups, busy, error, onCommand }: Props) {
  const [group,setGroup] = useState<string>('Todas');
  const [query,setQuery] = useState('');
  const [onlyLow,setOnlyLow] = useState(false);
  const [inclusive,setInclusive] = useState(false);
  const [form,setForm] = useState<{mode: FormMode; item?: Supply} | null>(null);
  const [formGroup,setFormGroup] = useState<SupplyGroup>(groups[0]);
  const [unit,setUnit] = useState('unidad');
  const [measurement,setMeasurement] = useState('ml');
  const [pdfError,setPdfError] = useState('');
  const [pdfBusy,setPdfBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy); busyRef.current = busy;
  const all = (state.supplies ?? []).filter(i=>groups.includes(i.group));
  const alerts = all.filter(i=>['agotado','bajo mínimo'].includes(supplyAlert(i,inclusive)));
  const items = all.filter(i=>(group==='Todas'||i.group===group) && i.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) && (!onlyLow||['agotado','bajo mínimo'].includes(supplyAlert(i,inclusive))));
  function show(mode: FormMode,item?: Supply) {
    if(actor.role!=='admin'&&(['create','edit'].includes(mode)||(actor.role==='cocina'?!['Cocina','Frutas congeladas','Preparados líquidos'].includes(item?.group??''):item?.group==='Cocina')))return;
    const chosenGroup = item?.group ?? (group==='Todas' ? groups[0] : group as SupplyGroup);
    setFormGroup(chosenGroup);
    setUnit(item?.unit ?? (chosenGroup==='Frutas congeladas' ? 'porcion' : chosenGroup==='Preparados líquidos' ? 'ml' : 'unidad'));
    setMeasurement('ml'); setForm({mode,item});
  }
  useEffect(()=>{
    if(!form) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    root?.querySelector<HTMLElement>('input,select')?.focus();
    function keyboard(e: KeyboardEvent) {
      if(e.key==='Escape'&&!busyRef.current) setForm(null);
      if(e.key!=='Tab'||!root) return;
      const nodes=[...root.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled),textarea:not(:disabled)')];
      const first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',keyboard);
    return()=>{document.removeEventListener('keydown',keyboard);previous?.focus();};
  },[form]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!form) return;
    const data=Object.fromEntries(new FormData(e.currentTarget));
    let payload: Record<string,unknown>;
    if(form.mode==='create') payload={type:'supplyCreate',name:data.name,group:formGroup,unit,minimum:data.minimum===''?null:Number(data.minimum),capacityMl:data.capacityMl?Number(data.capacityMl):null,packSize:formGroup==='Empaques'?Number(data.packSize||1):1,note:data.note};
    else if(form.mode==='edit') payload={type:'supplyUpdate',supplyId:form.item!.id,name:data.name,minimum:data.minimum===''?null:Number(data.minimum),note:data.note};
    else payload={type:'supplyMove',supplyId:form.item!.id,action:form.mode,responsible:data.responsible,note:data.note,...(measurement==='percent'?{percent:Number(data.percent)}:{quantity:Number(data.quantity)}),byPack:data.byPack==='true'};
    if(await onCommand(payload,'Registro de insumos guardado.')) setForm(null);
  }
  async function downloadPdf() {
    setPdfBusy(true);setPdfError('');
    try {
      const search=new URLSearchParams({inclusive:String(inclusive)});
      if(group!=='Todas') search.set('group',group);
      else if(groups.length===1) search.set('group',groups[0]);
      else search.set('groups',groups.join('|'));
      const response=await fetch(`/api/reports/low-stock?${search}`);
      if(!response.ok) throw new Error('No se pudo descargar el PDF. Revisa la conexión.');
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
      link.href=url;link.download='lune-insumos-por-reponer.pdf';link.click();URL.revokeObjectURL(url);
    } catch(e){setPdfError((e as Error).message);}finally{setPdfBusy(false);}
  }
  const title=form?.mode==='create'?'Registrar insumo':form?.mode==='edit'?'Editar insumo':form?.mode==='entrada'?'Registrar ingreso':form?.mode==='salida'?'Retirar para uso':form?.item?.stock===null?'Conteo inicial':'Registrar conteo';
  const item=form?.item;
  return <>
    <div className="supply-summary"><div><Package size={19}/><strong>{all.length}</strong><span>productos registrados</span></div><div><ClipboardList size={19}/><strong>{all.filter(i=>i.stock===null).length}</strong><span>sin conteo inicial</span></div><div><strong>{alerts.length}</strong><span>agotados o bajo mínimo</span></div></div>
    <section className="panel supplies-panel">
      <div className="panel-heading"><div><h2>{groups.length===1?groups[0]:'Insumos, bebidas y empaques'}</h2><p>Los productos sin conteo no se consideran agotados. Configura el mínimo de cada uno.</p></div><div className="actions"><button className="secondary" disabled={pdfBusy} onClick={downloadPdf}><Download size={15}/>{pdfBusy?'Generando…':'PDF por reponer'}</button><button className="primary" hidden={actor.role!=='admin'} onClick={()=>show('create')}><Plus size={16}/>Nuevo insumo</button></div></div>
      <div className="supply-toolbar"><label className="search-field"><Search size={15}/><input type="search" aria-label="Buscar insumo" placeholder="Buscar por nombre…" value={query} onChange={e=>setQuery(e.target.value)}/></label>{groups.length>1&&<label>Categoría<select value={group} onChange={e=>setGroup(e.target.value)}><option>Todas</option>{groups.map(g=><option key={g}>{g}</option>)}</select></label>}<label className="check-label"><input type="checkbox" checked={onlyLow} onChange={e=>setOnlyLow(e.target.checked)}/>Solo por reponer</label><label className="check-label"><input type="checkbox" checked={inclusive} onChange={e=>setInclusive(e.target.checked)}/>Incluir igual al mínimo</label></div>
      {pdfError&&<p role="alert" className="alert error">{pdfError}</p>}
      <div className="table-wrap" role="region" aria-label="Inventario de insumos" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>DISPONIBLE</th><th>MÍNIMO</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>{items.map(i=>{
        const status=supplyAlert(i,inclusive);
        return <tr key={i.id}><td className="supply-name"><strong>{i.name}</strong><small>{i.group}{i.capacityMl?` · ${i.capacityMl.toLocaleString('es-PE')} ml por ${i.unit==='ml'?'recipiente':'envase'}`:''}{i.packSize>1?` · ${i.packSize} unidades por millar`:''}</small>{i.note&&<small>{i.note}</small>}</td><td><strong>{i.stock===null?'Sin conteo':`${i.estimated?'≈ ':''}${i.stock.toLocaleString('es-PE')} ${unitLabel(i.unit)}`}</strong>{i.unit==='ml'&&i.stock!==null&&i.capacityMl&&<div className="liquid-level"><progress max={i.capacityMl} value={i.stock}/><small>{Math.round(i.stock/i.capacityMl*100)} %{i.estimated?' · estimado':''}</small></div>}</td><td>{i.minimum===null?'Sin definir':`${i.minimum} ${unitLabel(i.unit)}`}</td><td><span className={status==='agotado'||status==='bajo mínimo'?'pill low-pill':status==='disponible'?'pill green':'pill'}>{status}</span></td><td><div className="supply-row-actions" hidden={actor.role!=='admin'&&(actor.role==='cocina'?!['Cocina','Frutas congeladas','Preparados líquidos'].includes(i.group):i.group==='Cocina')}><button className="text-button" disabled={busy} onClick={()=>show('conteo',i)}>{i.stock===null?'Contar':'Conteo'}</button><button className="text-button" disabled={busy||i.stock===null} onClick={()=>show('entrada',i)}>{i.unit==='ml'?'Recargar':'Ingresar'}</button><button className="text-button" disabled={busy||i.stock===null||i.stock===0} onClick={()=>show('salida',i)}>Retirar</button><button className="text-button" hidden={actor.role!=='admin'} disabled={busy} onClick={()=>show('edit',i)}>Editar</button></div></td></tr>;
      })}</tbody></table>{!items.length&&<div className="empty">{all.length?'No hay productos con esos filtros.':'Añade los productos reales de esta categoría. No se han inventado existencias ni artículos.'}</div>}</div>
      <p className="sales-note">El PDF usa la categoría y el criterio seleccionados; la búsqueda por nombre no limita el reporte. Los mínimos sin definir requieren revisión.</p>
    </section>
    <details className="panel supply-history"><summary>Últimos movimientos de estas categorías</summary><div className="table-wrap"><table><thead><tr><th>FECHA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>SALDO</th><th>RESPONSABLE / MOTIVO</th></tr></thead><tbody>{(state.supplyMovements??[]).filter(m=>all.some(i=>i.id===m.supplyId)).slice(0,100).map(m=><tr key={m.id}><td>{localTime(m.at)}</td><td>{all.find(i=>i.id===m.supplyId)?.name}</td><td>{m.action}</td><td>{m.quantity}</td><td>{m.after}{m.estimated?' (estimado)':''}</td><td className="detail-cell">{m.responsible}<small>{m.note}</small></td></tr>)}</tbody></table></div></details>
    {form&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setForm(null);}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="supply-title" ref={dialogRef}><div className="modal-header"><div><div className="eyebrow">LUNE · INSUMOS</div><h2 id="supply-title">{title}</h2></div><button className="icon-button" disabled={busy} onClick={()=>setForm(null)} aria-label="Cerrar formulario de insumos"><X size={19}/></button></div><form onSubmit={submit}>
      {form.mode==='create'||form.mode==='edit'?<><label>Nombre<input name="name" required maxLength={180} defaultValue={item?.name??''}/></label>{form.mode==='create'&&<><label>Categoría<select value={formGroup} onChange={e=>{const value=e.target.value as SupplyGroup;setFormGroup(value);setUnit(value==='Frutas congeladas'?'porcion':value==='Preparados líquidos'?'ml':'unidad');}}>{groups.map(g=><option key={g}>{g}</option>)}</select></label><label>Unidad de control<select value={unit} onChange={e=>setUnit(e.target.value)} disabled={formGroup==='Frutas congeladas'||formGroup==='Preparados líquidos'}>{SUPPLY_UNITS.map(u=><option value={u} key={u}>{unitLabel(u)}</option>)}</select></label><label>Capacidad en ml {unit==='ml'?'(obligatoria)':'(opcional)'}<input name="capacityMl" type="number" min="1" max="1000000000" step="1" required={unit==='ml'}/></label>{formGroup==='Empaques'&&<label>Unidades por paquete o millar<input name="packSize" required type="number" min="1" max="1000000000" step="1" defaultValue="1000"/></label>}</>}<label>Mínimo de reposición ({unitLabel((item?.unit??unit) as Supply['unit'])})<input name="minimum" type="number" min="0" max="1000000000" step="1" defaultValue={item?.minimum??''} placeholder="Sin definir"/></label><label>Observaciones (opcional)<textarea name="note" maxLength={500} defaultValue={item?.note??''}/></label><p className="form-note">La unidad de un producto con movimientos no se cambia para proteger el historial. El catálogo admite los futuros insumos de cocina sin un límite fijo de filas en pantalla.</p></>:<>
        <p className="form-note"><strong>{item!.name}</strong><br/>{item!.stock===null?'Primero registra cuánto hay realmente.':`Disponible: ${item!.stock} ${unitLabel(item!.unit)}.`}</p>
        {form.mode==='conteo'&&item!.unit==='ml'&&<label>Cómo registrar el contenido<select value={measurement} onChange={e=>setMeasurement(e.target.value)}><option value="ml">Mililitros medidos</option><option value="percent">Porcentaje estimado del recipiente</option></select></label>}
        <label>{measurement==='percent'?'Porcentaje que queda':form.mode==='conteo'?`Cantidad que queda (${unitLabel(item!.unit)})`:`Cantidad (${unitLabel(item!.unit)})`}<input required type="number" name={measurement==='percent'?'percent':'quantity'} min={form.mode==='conteo'?0:1} max={measurement==='percent'?100:item!.unit==='ml'?item!.capacityMl??1000000000:1000000000} step={measurement==='percent'?'.1':'1'}/></label>
        {form.mode==='entrada'&&item!.group==='Empaques'&&item!.packSize>1&&<label>Presentación ingresada<select name="byPack"><option value="false">Unidades sueltas</option><option value="true">Millares de {item!.packSize} unidades</option></select></label>}
        <label>Responsable{actor.role==='admin'?<input name="responsible" required maxLength={80} autoComplete="off"/>:<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{(actor.role==='cocina'?COOKS:WAITERS).map(name=><option key={name}>{name}</option>)}</select>}</label><label>Motivo {form.mode==='conteo'&&item!.stock!==null?'(obligatorio)':'(opcional)'}<textarea name="note" maxLength={500} required={form.mode==='conteo'&&item!.stock!==null}/></label>
        {item!.unit==='ml'&&<p className="form-note">Capacidad: {item!.capacityMl} ml. Un porcentaje se convierte a ml aproximados y queda identificado como estimación. No hay descuento automático por recetas.</p>}
      </>}
      {error&&<div role="alert" className="alert error">{error}</div>}<div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button><button className="primary" disabled={busy} type="submit">{busy?'Guardando…':'Guardar'}</button></div>
    </form></div></div>}
  </>;
}
