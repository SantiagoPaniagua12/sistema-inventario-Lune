'use client';
import {useRef,useState,type FormEvent} from 'react';
import type {State,Product} from '@/lib/inventory';
import {limaDate} from '@/lib/inventory';
import {bakedQuantity,isKitchenProduct} from '@/lib/baking';
import {COOKS} from '@/lib/staff';
import {ManualCountInput} from './manual-count-input';
type Props={state:State;busy:boolean;error:string;onCommand:(data:Record<string,unknown>,message:string)=>Promise<boolean|undefined>};
export function BakingWorkspace({state,busy,error,onCommand}:Props){
 const [date,setDate]=useState(limaDate()),[period,setPeriod]=useState('Mañana'),[query,setQuery]=useState('');
 const [form,setForm]=useState<{product:Product;mode:'bakeBatch'|'useBaked'}|null>(null);
 const request=useRef<{payload:string;id:string}|null>(null);
 const products=state.products.filter(p=>p.category==='Bollería'&&(p.active!==false||bakedQuantity(state,p.id)>0)&&p.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
 const logs=state.movements.filter(m=>(m.type==='Horneado en cocina'||m.type==='Uso en platos')&&m.serviceDate===date&&m.period===period);
 const frozen=(id:string)=>state.lots.filter(l=>l.productId===id).reduce((n,l)=>n+l.quantity,0);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!form||busy)return;
  const fields=Object.fromEntries(new FormData(event.currentTarget)),quantity=Number(fields.quantity);
  const payload={type:form.mode,date,period,responsible:fields.responsible,note:fields.note,...(form.mode==='bakeBatch'?{items:[{productId:form.product.id,quantity}]}:{productId:form.product.id,quantity})};
  const serialized=JSON.stringify(payload);if(request.current?.payload!==serialized)request.current={payload:serialized,id:crypto.randomUUID()};
  if(await onCommand({...payload,operationId:request.current.id},form.mode==='bakeBatch'?'Horneado registrado. Las unidades quedan disponibles en Cocina.':'Uso en platos registrado para el turno de Cocina.')){setForm(null);request.current=null;}
 }
 return <>
  <section className="panel"><div className="panel-heading"><div><h2>Horneados en cocina</h2><p>Hornea desde la reserva congelada. Envía solo las unidades necesarias al mostrador.</p></div></div>
   <div className="toolbar"><label>Fecha de Cocina<input type="date" max={limaDate()} value={date} disabled={busy||!!form} onChange={e=>setDate(e.target.value)}/></label><label>Turno<select value={period} disabled={busy||!!form} onChange={e=>setPeriod(e.target.value)}><option>Mañana</option><option>Tarde</option></select></label><input type="search" aria-label="Buscar bollería" placeholder="Buscar bollería…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <p className="form-note">El disponible reúne los horneados pendientes de usar o enviar, incluidos los de turnos anteriores. Las columnas de horneado y uso corresponden a la fecha y turno seleccionados.</p>
   <div className="table-wrap"><table><thead><tr><th>PRODUCTO</th><th>CONGELADOS</th><th>HORNEADOS DISPONIBLES</th><th>HORNEADOS DEL TURNO</th><th>USADOS EN PLATOS</th><th>ACCIONES DE COCINA</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong>{isKitchenProduct(p)&&<small>Uso exclusivo en platos de Cocina</small>}</td><td>{frozen(p.id)}</td><td>{bakedQuantity(state,p.id)}</td><td>{logs.filter(m=>m.productId===p.id&&m.type==='Horneado en cocina').reduce((n,m)=>n+m.quantity,0)}</td><td>{isKitchenProduct(p)?logs.filter(m=>m.productId===p.id&&m.type==='Uso en platos').reduce((n,m)=>n+m.quantity,0):'—'}</td><td><div className="actions"><button className="secondary" disabled={busy||p.active===false||!frozen(p.id)} onClick={()=>setForm({product:p,mode:'bakeBatch'})}>Registrar horneado</button>{isKitchenProduct(p)&&<button className="secondary" disabled={busy||!bakedQuantity(state,p.id)} onClick={()=>setForm({product:p,mode:'useBaked'})}>Usar en platos</button>}</div></td></tr>)}</tbody></table>{!products.length&&<div className="empty">No hay bollería con esta búsqueda.</div>}</div>
  </section>
  <section className="panel"><div className="panel-heading"><h2>Movimientos de Cocina del turno</h2></div><div className="table-wrap"><table><thead><tr><th>HORA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>UNIDADES</th><th>COCINERO / NOTA</th></tr></thead><tbody>{logs.map(m=><tr key={m.id}><td>{new Date(m.at).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'})}</td><td>{state.products.find(p=>p.id===m.productId)?.name}</td><td>{m.type}</td><td>{m.quantity}</td><td>{m.responsible}<small>{m.note}</small></td></tr>)}</tbody></table>{!logs.length&&<div className="empty">Sin horneados ni usos registrados en este turno.</div>}</div></section>
  {form&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="baking-title"><div className="modal-header"><h2 id="baking-title">{form.mode==='bakeBatch'?'Registrar horneado':'Usar en platos'}</h2><button className="icon-button" aria-label="Cerrar formulario" disabled={busy} onClick={()=>setForm(null)}>×</button></div><form onSubmit={submit}><p><strong>{form.product.name}</strong> · {date} · {period}</p><label>Unidades<ManualCountInput autoFocus required name="quantity" min="1" max={form.mode==='bakeBatch'?frozen(form.product.id):bakedQuantity(state,form.product.id)} step="1"/></label><label>Cocinero<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{COOKS.map(name=><option key={name}>{name}</option>)}</select></label><label>Nota (opcional)<input name="note" maxLength={180}/></label>{error&&<p className="alert error" role="alert">{error}</p>}<div className="actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar'}</button></div></form></section></div>}
 </>;
}
