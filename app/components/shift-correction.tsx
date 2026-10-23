'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import type {State,Shift,Row,Product} from '@/lib/inventory';
import {shiftLabel} from '@/lib/inventory';

export function ShiftCorrection({state,shift,row,product,busy,onSave}:{state:State;shift:Shift;row:Row;product:Product;busy:boolean;onSave:(data:Record<string,unknown>,message:string)=>Promise<boolean>}) {
  const [editing,setEditing]=useState(false);
  const [incoming,setIncoming]=useState(String(row.incoming));
  const [error,setError]=useState('');
  const dialogRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!editing)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    function trap(event:KeyboardEvent){
      if(event.key!=='Tab')return;
      const fields=[...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[])];
      const first=fields[0],last=fields.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[editing]);
  const index=state.shifts.findIndex(s=>s.id===shift.id);
  if(index<0 || state.shifts.slice(index+1).some(s=>s.status==='closed'))return null;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    const data=Object.fromEntries(new FormData(event.currentTarget));
    const saved=await onSave({...data,type:'correctShift',shiftId:shift.id,productId:product.id,incoming:Number(data.incoming),...(shift.status==='closed'?{closing:Number(data.closing)}:{})},'Corrección guardada. Los ingresos, la reserva y la venta calculada están actualizados.');
    if(saved)setEditing(false);else setError('No se guardó la corrección. Revisa el mensaje de error de la página.');
  }
  return <>
    <button className="text-button" type="button" disabled={busy} aria-label={`Corregir ingreso o cierre de ${product.name}`} onClick={()=>{setIncoming(String(row.incoming));setError('');setEditing(true);}}>Corregir</button>
    {editing&&createPortal(<div className="modal-backdrop"><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={`Corregir ${product.name}`} onKeyDown={event=>{if(event.key==='Escape'&&!busy)setEditing(false);}}>
      <div className="modal-header"><h2>Corregir {product.name}</h2><button type="button" className="icon-button" disabled={busy} onClick={()=>setEditing(false)} aria-label="Cerrar corrección">×</button></div>
      <form onSubmit={submit}>
        <p className="form-note">{shift.date} · {shift.period}. La corrección conserva el registro anterior y recalcula las ventas. El cierre corregido será la entrada del siguiente turno abierto.</p>
        <label>Ingreso total del turno<input autoFocus name="incoming" type="number" required min="0" max="100000" step="1" value={incoming} onChange={event=>setIncoming(event.target.value)}/></label>
        {shift.status==='closed'?<label>Stock al cierre<input name="closing" type="number" required min="0" max={row.opening+Number(incoming)-row.waste} step="1" defaultValue={row.closing??0}/></label>:<p className="form-note">El stock al cierre se puede editar directamente en la tabla antes de cerrar el turno.</p>}
        <p className="form-note">Responsables: {shiftLabel(shift)}. El sistema ajustará automáticamente la reserva según el ingreso corregido.</p>
        <label>Motivo<input name="reason" required maxLength={180} placeholder="Explica el error que estás corrigiendo"/></label>
        {error&&<p role="alert" className="invalid-text">{error}</p>}
        <div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar corrección'}</button></div>
      </form>
    </section></div>,document.body)}
  </>;
}
