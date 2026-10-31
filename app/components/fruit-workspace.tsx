'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {shiftTeam,type State} from '@/lib/inventory';
import type {Actor} from '@/lib/access';
import {fruitWithdrawals} from '@/lib/fruit-withdrawals';
import {FruitBatchWithdrawalDialog} from './fruit-batch-dialog';
import {ManualCountInput} from './manual-count-input';

type Props={actor:Actor;state:State;busy:boolean;error:string;historical?:boolean;onCommand:(data:Record<string,unknown>,message:string)=>Promise<boolean|undefined>};
const localTime=(at:string)=>new Date(at).toLocaleString('es-PE',{timeZone:'America/Lima'});
type Form={supplyId:string;withdrawalId?:string;cancel?:boolean};
export function FruitWorkspace({actor,state,busy,error,historical=false,onCommand}:Props){
 const [historyShift,setHistoryShift]=useState(state.shifts.at(-1)?.id??'');
 const [form,setForm]=useState<Form|null>(null);
 const [batchShiftId,setBatchShiftId]=useState<string|null>(null);
 const shift=historical?state.shifts.find(s=>s.id===historyShift):state.shifts.find(s=>s.status==='open');
 const fruits=state.supplies?.filter(i=>i.group==='Frutas congeladas')??[];
 const withdrawals=shift?fruitWithdrawals(state,shift.id):[];
 const canCorrect=!!shift&&(shift.status==='open'||actor.role==='admin');
 if(actor.role==='cocina')return null;
 return <section className="panel fruit-workspace" aria-label={historical?'Retiros de fruta por turno':'Frutas congeladas'}>
  <div className="panel-heading"><div><h2>{historical?'Retiros de fruta por turno':'Frutas congeladas'}</h2><p>Registra las porciones de varias frutas en un solo formulario. El stock se descuenta al guardar.</p></div>{!historical&&<button className="primary" disabled={busy||!shift||!fruits.some(f=>f.active!==false&&!f.mergedInto&&(f.stock??0)>0)} onClick={()=>setBatchShiftId(shift?.id??null)}>Registrar retiros</button>}</div>
  {historical&&<div className="fruit-toolbar"><label>Turno de frutas<select value={historyShift} disabled={busy} onChange={e=>{setHistoryShift(e.target.value);setForm(null);}}><option value="">Selecciona un turno</option>{state.shifts.toReversed().map(s=><option key={s.id} value={s.id}>{s.date} · {s.period} · {s.status==='open'?'Abierto':'Cerrado'}</option>)}</select></label></div>}
  {!historical&&!shift&&<p className="fruit-note" role="status">Abre un turno para registrar retiros de fruta.</p>}
  {!historical&&<div className="table-wrap" role="region" aria-label="Existencias de fruta congelada" tabIndex={0}><table><thead><tr><th>FRUTA</th><th>DISPONIBLES</th><th>RETIRADAS EN EL TURNO</th></tr></thead><tbody>{fruits.filter(i=>i.active!==false||(i.stock??0)>0).map(f=><tr key={f.id}><td><strong>{f.name}</strong></td><td>{f.stock===null?'Sin conteo inicial':`${f.stock} porciones`}</td><td>{withdrawals.filter(w=>w.supplyId===f.id).reduce((n,w)=>n+w.quantity,0)} porciones</td></tr>)}</tbody></table>{!fruits.length&&<p className="empty">No hay frutas registradas.</p>}</div>}
  <div className="fruit-log"><h3>{historical?'Retiros registrados':'Retiros del turno'}</h3>{withdrawals.length?<div className="table-wrap" role="region" aria-label="Retiros de fruta" tabIndex={0}><table><thead><tr><th>HORA</th><th>FRUTA</th><th>PORCIONES</th><th>RESPONSABLE</th><th>ACCIONES</th></tr></thead><tbody>{withdrawals.map(w=><tr key={w.id}><td>{localTime(w.at)}</td><td>{fruits.find(f=>f.id===w.supplyId)?.name??'Fruta'}<small>{w.quantity===0?'Anulado':w.logs.length>1?'Corregido':''}</small></td><td>{w.quantity}</td><td>{w.responsible}</td><td><div className="actions"><button className="text-button" disabled={busy||!canCorrect} onClick={()=>setForm({supplyId:w.supplyId,withdrawalId:w.id})}>Corregir</button><button className="text-button" disabled={busy||!canCorrect||w.quantity===0} onClick={()=>setForm({supplyId:w.supplyId,withdrawalId:w.id,cancel:true})}>Anular</button></div><details className="fruit-details"><summary>Ver historial</summary>{w.logs.toReversed().map(m=><p key={m.id}>{localTime(m.at)} · {m.responsible}<br/>{fruits.find(f=>f.id===m.supplyId)?.name}: {m.action==='entrada'?'+':'−'}{m.quantity} porciones · Stock: {m.before} → {m.after}<br/>{m.note}</p>)}</details></td></tr>)}</tbody></table></div>:<p className="fruit-note">No hay retiros de fruta en este turno.</p>}</div>
  {batchShiftId&&<FruitBatchWithdrawalDialog state={state} shiftId={batchShiftId} busy={busy} serverError={error} onSave={onCommand} onClose={()=>setBatchShiftId(null)}/>}
  {form&&shift&&<FruitWithdrawalDialog key={`${form.withdrawalId??form.supplyId}-${form.cancel??false}`} actor={actor} state={state} shiftId={shift.id} form={form} busy={busy} serverError={error} onSave={onCommand} onClose={()=>setForm(null)}/>}
 </section>;
}
export function FruitWithdrawalDialog({actor,state,shiftId,form,busy,serverError,onSave,onClose}:{actor:Actor;state:State;shiftId:string;form:Form;busy:boolean;serverError:string;onSave:Props['onCommand'];onClose:()=>void}){
 const current=form.withdrawalId?fruitWithdrawals(state,shiftId).find(w=>w.id===form.withdrawalId):undefined;
 const [version]=useState(current?.logs[0].id);
 const [supplyId,setSupplyId]=useState(form.supplyId);
 const [quantity,setQuantity]=useState(current?String(current.quantity||''):'');
 const [error,setError]=useState('');
 const [pending,setPending]=useState(false);
 const request=useRef<{payload:string;id:string}|null>(null),saving=useRef(false);
 const dialog=useRef<HTMLElement>(null),busyRef=useRef(busy);busyRef.current=busy||pending;
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const shift=state.shifts.find(s=>s.id===shiftId)!;
 const fruits=state.supplies?.filter(i=>i.group==='Frutas congeladas')??[];
 const fruit=fruits.find(i=>i.id===supplyId);
 const cancel=form.cancel===true;
 const changed=!!form.withdrawalId&&(!current||current.logs[0].id!==version);
 const locked=busy||pending;
 const title=cancel?'Anular retiro de fruta':current?'Corregir retiro de fruta':'Registrar retiro de fruta';
 const limit=fruit?.stock===null?0:(fruit?.stock??0)+(current?.supplyId===supplyId?current.quantity:0);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';dialog.current?.querySelector<HTMLElement>('form select,form input')?.focus();
  function keys(e:KeyboardEvent){
   if(e.key==='Escape'&&!busyRef.current){e.preventDefault();closeRef.current();}
   if(e.key!=='Tab')return;
   const fields=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[])];
   if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}
   else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}
  }
  document.addEventListener('keydown',keys);return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(locked||saving.current||changed)return;setError('');
  const fields=Object.fromEntries(new FormData(e.currentTarget)),amount=cancel?0:Number(quantity);
  if(!cancel&&(!quantity.trim()||!Number.isSafeInteger(amount)||amount<1||amount>limit)){setError('Revisa las porciones y el stock disponible.');return;}
  const data:Record<string,unknown>={type:current?'supplyFruitWithdrawalCorrection':'supplyFruitWithdrawal',shiftId,supplyId,quantity:amount,responsible:shift.status==='closed'?actor.name:fields.responsible,...(current?{withdrawalId:current.id,withdrawalVersion:version,reason:String(fields.reason??'').trim(),cancel}:{})};
  if(current&&!data.reason){setError('Escribe el motivo de la corrección.');return;}
  const payload=JSON.stringify(data);if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
  saving.current=true;setPending(true);
  try{if(await onSave({...data,operationId:request.current!.id},cancel?'Retiro anulado. Las porciones volvieron al stock.':current?'Retiro corregido. El stock y el historial están actualizados.':'Retiro de fruta registrado.'))onClose();}
  finally{saving.current=false;setPending(false);}
 }
 return <div className="modal-backdrop"><section className="modal operation-modal fruit-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="fruit-title"><div className="modal-header"><h2 id="fruit-title">{title}</h2><button className="icon-button" disabled={locked} aria-label="Cerrar formulario" onClick={onClose}><X size={20}/></button></div>
 <form onSubmit={submit}><fieldset className="operation-fields" disabled={locked}><div className="operation-scroll">
 <p className="form-note">{shift.date} · {shift.period}</p>
 {current&&<p className="form-note">Retiro vigente: <strong>{fruits.find(f=>f.id===current.supplyId)?.name} · {current.quantity} porciones</strong>. Responsable original: {current.responsible}.</p>}
 {cancel?<p className="form-note">Confirmar esta anulación devolverá {current?.quantity} porciones al stock. El retiro permanecerá en el historial.</p>:<><label>Fruta<select name="supplyId" value={supplyId} onChange={e=>setSupplyId(e.target.value)} required>{fruits.filter(f=>f.active!==false||f.id===supplyId).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Porciones{current?' correctas':''}<ManualCountInput name="quantity" required min="1" max={limit} step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><p className="form-note">Disponible: {fruit?.stock===null?'sin conteo inicial':`${fruit?.stock??0} porciones`}.{current&&quantity.trim()&&Number.isSafeInteger(Number(quantity))&&<> Stock resultante de {fruit?.name}: <strong>{limit-Number(quantity)}</strong> porciones.{current.supplyId!==supplyId&&<> Se devolverán {current.quantity} porciones de {fruits.find(f=>f.id===current.supplyId)?.name}.</>}</>}</p></>}
 {shift.status==='open'?<label>Mozo responsable<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona un mozo del turno</option>{shiftTeam(shift).map(name=><option key={name}>{name}</option>)}</select></label>:<p className="form-note">Corrección por Administración: {actor.name}. Se ajustará el stock actual sin reabrir el turno.</p>}
 {current&&<label>Motivo de {cancel?'anulación':'corrección'}<input name="reason" required maxLength={180}/></label>}
 {changed&&<p className="alert error" role="alert">Este retiro cambió en otra sesión. Cierra y vuelve a abrir el formulario para revisar los datos actualizados.</p>}
 {(error||serverError)&&<p className="alert error" role="alert">{error||serverError}</p>}
 </div><div className="modal-footer"><button className="secondary" type="button" disabled={locked} onClick={onClose}>Cancelar</button><button className="primary" disabled={locked||changed}>{locked?'Guardando…':cancel?'Confirmar anulación':current?'Guardar corrección':'Guardar retiro'}</button></div></fieldset></form></section></div>;
}
