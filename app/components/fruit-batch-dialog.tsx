'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {shiftTeam,type State} from '@/lib/inventory';
import {ManualCountInput} from './manual-count-input';

type Props={state:State;shiftId:string;busy:boolean;serverError:string;onSave:(data:Record<string,unknown>,message:string)=>Promise<boolean|undefined>;onClose:()=>void};
export function FruitBatchWithdrawalDialog({state,shiftId,busy,serverError,onSave,onClose}:Props){
 const shift=state.shifts.find(s=>s.id===shiftId),fruits=state.supplies?.filter(f=>f.group==='Frutas congeladas')??[];
 const [quantities,setQuantities]=useState<Record<string,string>>({}),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const dialog=useRef<HTMLElement>(null),saving=useRef(false),request=useRef<{payload:string;id:string}|null>(null);
 const locked=busy||pending,lockedRef=useRef(locked);lockedRef.current=locked;
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const entered=fruits.flatMap(f=>{const raw=quantities[f.id]??'';return raw.trim()!==''&&Number(raw)!==0?[{supplyId:f.id,quantity:Number(raw)}]:[];});
 const total=entered.reduce((n,row)=>n+row.quantity,0);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';dialog.current?.querySelector<HTMLElement>('form select,form input:not(:disabled)')?.focus();
  function keys(e:KeyboardEvent){
   if(e.key==='Escape'&&!lockedRef.current){e.preventDefault();closeRef.current();}
   if(e.key!=='Tab')return;
   const fields=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[])];
   if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}
   else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}
  }
  document.addEventListener('keydown',keys);return()=>{document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(locked||saving.current)return;setError('');
  if(!shift||shift.status!=='open'){setError('Necesitas un turno abierto para registrar retiros.');return;}
  if(!entered.length){setError('Escribe las porciones de al menos una fruta.');return;}
  for(const row of entered){
   const f=fruits.find(f=>f.id===row.supplyId)!;
   if(!Number.isSafeInteger(row.quantity)||row.quantity<1||f.stock===null||row.quantity>f.stock||f.active===false||f.mergedInto){setError(`Revisa las porciones de ${f.name} y su stock disponible.`);return;}
  }
  const fields=Object.fromEntries(new FormData(e.currentTarget)),responsible=String(fields.responsible??'');
  if(!shiftTeam(shift).includes(responsible)){setError('Selecciona un mozo del equipo del turno.');return;}
  const data={type:'supplyFruitWithdrawalBatch',shiftId,responsible,items:entered};
  const payload=JSON.stringify(data);if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
  saving.current=true;setPending(true);
  try{if(await onSave({...data,operationId:request.current!.id},`Retiros guardados: ${entered.length} frutas · ${total} porciones.`))onClose();}
  catch{setError('No se pudo confirmar el guardado. Vuelve a intentarlo.');}
  finally{saving.current=false;setPending(false);}
 }
 return <div className="modal-backdrop"><section className="modal operation-modal batch-modal fruit-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="fruit-batch-title">
  <div className="modal-header"><h2 id="fruit-batch-title">Registrar retiros de frutas</h2><button className="icon-button" aria-label="Cerrar formulario" disabled={locked} onClick={onClose}><X size={20}/></button></div>
  <form onSubmit={submit}><fieldset className="operation-fields" disabled={locked}><div className="operation-scroll">
   <p className="form-note">{shift?.date} · {shift?.period}. Escribe solo las porciones que retiras ahora.</p>
   <label>Mozo responsable<select name="responsible" required defaultValue="" onChange={()=>setError('')}><option value="" disabled>Selecciona un mozo del turno</option>{shift&&shiftTeam(shift).map(name=><option key={name}>{name}</option>)}</select></label>
   <div className="batch-products"><div className="batch-list-heading"><span>Fruta</span><span>Stock</span><span>A retirar</span></div>{fruits.map(f=>{
    const unavailable=f.active===false||!!f.mergedInto||f.stock===null||f.stock===0;
    const status=f.active===false||f.mergedInto?'Desactivada':f.stock===null?'Sin conteo inicial':f.stock===0?'Agotada':'';
    return <label className="batch-product-row" key={f.id}><span>{f.name}{status&&<small>{status}</small>}</span><span className="batch-stock">{f.stock===null?'Sin conteo':`${f.stock} porc.`}</span><ManualCountInput name={`quantity:${f.id}`} data-fruit={f.id} aria-label={`Porciones a retirar de ${f.name}`} disabled={unavailable} title={status||`Porciones disponibles: ${f.stock}`} min="0" max={f.stock??0} step="1" placeholder="0" value={quantities[f.id]??''} onChange={e=>{setQuantities(previous=>({...previous,[f.id]:e.target.value}));setError('');}}/></label>;
   })}</div>
   <p className="batch-total"><strong>{entered.length} frutas · {total} porciones</strong></p>
   <p className="form-note">Los campos vacíos o en cero no generan retiros. Se guardan todas las frutas juntas; si alguna cantidad no está disponible, no se descuenta ninguna.</p>
   {(!shift||shift.status!=='open')&&<p className="alert error" role="alert">El turno ya no está abierto.</p>}
   {(error||serverError)&&<p className="alert error" role="alert">{error||serverError}</p>}
  </div><div className="modal-footer"><button className="secondary" type="button" disabled={locked} onClick={onClose}>Cancelar</button><button className="primary" disabled={locked||!shift||shift.status!=='open'}>{locked?'Guardando…':'Guardar retiros'}</button></div></fieldset></form>
 </section></div>;
}
