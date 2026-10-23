'use client';

import {useEffect,useRef} from 'react';
import {Check,X} from 'lucide-react';
import {available,shiftLabel,type Shift,type Product} from '@/lib/inventory';

export const closingFingerprint=(shift:Shift,counts:Record<string,string>)=>JSON.stringify(shift.rows.map(row=>[row.productId,counts[row.productId]??'']));

export function CloseShiftDialog({shift,products,counts,busy,error,onCancel,onConfirm}:{shift:Shift;products:Product[];counts:Record<string,string>;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}){
  const dialogRef=useRef<HTMLElement>(null);
  const busyRef=useRef(busy);busyRef.current=busy;
  const cancelRef=useRef(onCancel);cancelRef.current=onCancel;
  const remaining=shift.rows.reduce((sum,row)=>sum+Number(counts[row.productId]??0),0);
  const sold=shift.rows.reduce((sum,row)=>sum+available(row)-Number(counts[row.productId]??0),0);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    dialogRef.current?.querySelector<HTMLElement>('[data-return]')?.focus();
    function trap(event:KeyboardEvent){
      if(event.key==='Escape'&&!busyRef.current){event.preventDefault();cancelRef.current();return;}
      if(event.key!=='Tab')return;
      const fields=[...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')??[])];
      const first=fields[0],last=fields.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  return <div className="modal-backdrop"><section ref={dialogRef} className="modal operation-modal close-shift-dialog" role="dialog" aria-modal="true" aria-labelledby="close-shift-title">
    <div className="modal-header"><div><div className="eyebrow">REVISIÓN DEL TURNO</div><h2 id="close-shift-title">Confirmar cierre de turno</h2></div><button className="icon-button" disabled={busy} onClick={onCancel} aria-label="Volver al conteo"><X size={20}/></button></div>
    <div className="operation-scroll">
      <p className="form-note">{shift.date} · Turno {shift.period.toLowerCase()}<br/><strong>Responsables: {shiftLabel(shift)}</strong></p>
      <div className="close-summary"><div><strong>{shift.rows.length}</strong><span>productos contados</span></div><div><strong>{remaining}</strong><span>unidades al cierre</span></div><div><strong>{sold}</strong><span>ventas calculadas</span></div></div>
      <div className="table-wrap" role="region" aria-label="Resumen de conteos al cierre" tabIndex={0}><table><thead><tr><th>PRODUCTO</th><th>STOCK AL CIERRE</th></tr></thead><tbody>{shift.rows.map(row=><tr key={row.productId}><td>{products.find(product=>product.id===row.productId)?.name??'Producto'}</td><td><strong>{counts[row.productId]}</strong></td></tr>)}</tbody></table></div>
      <p className="form-note">El stock al cierre será la entrada del siguiente turno. Puedes volver para revisar los conteos sin perder lo guardado.</p>
      {error&&<div className="alert error" role="alert">{error}</div>}
    </div>
    <div className="modal-footer"><button data-return className="secondary" disabled={busy} onClick={onCancel}>Volver al conteo</button><button className="primary" disabled={busy} onClick={onConfirm}><Check size={16}/>{busy?'Guardando cierre…':'Confirmar cierre'}</button></div>
  </section></div>;
}
