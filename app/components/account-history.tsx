'use client';
import {useEffect,useRef,useState} from 'react';
import type {Actor} from '@/lib/access';
import {HISTORY_KINDS,type HistoryPage,type HistoryKind} from '@/lib/operation-history';
const dateTime=(s:string)=>new Intl.DateTimeFormat('es-PE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(s));
const areas:Record<string,string>={admin:'Administración',mozo:'Salón',cocina:'Cocina'};
export function AccountHistory({actor,revision,onReviewShift}:{actor:Actor;revision:number;onReviewShift?:(shiftId:string)=>void}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[kind,setKind]=useState('');
 const [page,setPage]=useState<HistoryPage>({entries:[],nextCursor:null}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const requestId=useRef(0);
 const kinds:readonly HistoryKind[]=actor.role==='admin'?HISTORY_KINDS:actor.role==='cocina'?['Producción','Insumos']:['Turnos','Mostrador','Insumos'];
 async function load(cursor?:string){
  const id=++requestId.current;setLoading(true);setError('');
  try{
   const query=new URLSearchParams();if(from)query.set('from',from);if(to)query.set('to',to);if(kind)query.set('kind',kind);if(cursor)query.set('cursor',cursor);
   const response=await fetch('/api/inventory/history?'+query,{cache:'no-store'});const data=await response.json();
   if(!response.ok)throw new Error(data.error||'No se pudo cargar el historial.');
   if(id===requestId.current)setPage(previous=>cursor?{entries:[...previous.entries,...data.entries],nextCursor:data.nextCursor}:data);
  }catch(e){if(id===requestId.current){setPage({entries:[],nextCursor:null});setError((e as Error).message);}}
  finally{if(id===requestId.current)setLoading(false);}
 }
 useEffect(()=>{setPage({entries:[],nextCursor:null});void load();return()=>{requestId.current++;};},[actor.id,from,to,kind,revision]);
 return <section className="panel account-history" aria-label="Historial de operaciones de la cuenta">
  <div className="panel-heading"><div><h2>{actor.role==='admin'?'Operaciones de todas las cuentas':'Movimientos de '+(areas[actor.role]??actor.name)}</h2><p>{actor.role==='admin'?'Auditoría de operaciones por cuenta autenticada.':'Solo aparecen las operaciones registradas con esta cuenta de '+areas[actor.role]+'.'}</p></div></div>
  <div className="supply-toolbar"><label>Desde<input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label><label>Tipo de movimiento<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">Todos</option>{kinds.map(k=><option key={k}>{k}</option>)}</select></label><button type="button" className="secondary" disabled={loading} onClick={()=>void load()}>Actualizar historial</button></div>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {loading&&!page.entries.length?<p role="status" className="empty">Cargando movimientos…</p>:<>
   <div className="table-wrap" role="region" aria-label="Movimientos por cuenta" tabIndex={0}><table><thead><tr><th>FECHA · HORA</th><th>MOVIMIENTO</th><th>TURNO</th><th>RESPONSABLES Y DETALLE</th>{actor.role==='admin'&&<th>CUENTA</th>}</tr></thead><tbody>{page.entries.map(entry=><tr key={entry.id}>
    <td>{dateTime(entry.at)}</td><td><strong>{entry.label}</strong><small style={{display:'block'}}>{entry.kind}</small></td>
    <td>{entry.summary.shift?`${entry.summary.shift.date} · ${entry.summary.shift.period}`:'Sin turno asociado'}{onReviewShift&&entry.summary.shift&&entry.action==='close'&&<button className="text-button" type="button" onClick={()=>onReviewShift(entry.summary.shift!.id)}>Ver conteo del turno</button>}</td>
    <td className="detail-cell"><strong>{entry.summary.responsibles.join(', ')||'Sin responsable declarado'}</strong>{entry.summary.note&&<p>{entry.summary.note}</p>}
     {entry.summary.items.length>0&&<details><summary>Ver productos y cantidades ({entry.summary.items.length})</summary><ul>{entry.summary.items.map((item,index)=><li key={index}>{item.name}: {item.before!==undefined?`${item.before??'Sin conteo'} → ${item.after??'Sin conteo'}`:item.quantity??'Cantidad no disponible'} {item.unit}</li>)}</ul></details>}
     {entry.legacy&&<small>Registro anterior: se muestran únicamente los datos que quedaron guardados.</small>}
    </td>{actor.role==='admin'&&<td>{entry.account}<small style={{display:'block'}}>{areas[entry.area]??entry.area}</small></td>}
   </tr>)}</tbody></table></div>
   {!page.entries.length&&!error&&<div className="empty">No hay movimientos para esta cuenta y estos filtros.</div>}
   {page.nextCursor&&<div className="table-footer"><button className="secondary" disabled={loading} onClick={()=>void load(page.nextCursor!)}>{loading?'Cargando…':'Ver movimientos anteriores'}</button></div>}
  </>}
  <p className="legacy-note">Los movimientos antiguos sin una cuenta identificable permanecen disponibles para Administración.</p>
 </section>;
}
