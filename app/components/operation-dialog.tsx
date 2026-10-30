'use client';
import {isKitchenProduct,bakedQuantity} from '@/lib/baking';
import {ManualCountInput} from './manual-count-input';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,Check,X} from 'lucide-react';
import {limaDate,shiftTeam,type State} from '@/lib/inventory';
import {COOKS,WAITERS} from '@/lib/staff';

export type OperationKind='open'|'produce'|'replenish'|'addWaiters'|'replaceWaiter'|'correctProduction'|'adjustReserve'|'correctLotDate';
export const isOperationKind=(kind:string|null):kind is OperationKind=>['open','produce','replenish','addWaiters','replaceWaiter','correctProduction','adjustReserve','correctLotDate'].includes(kind??'');
const titles:Record<OperationKind,string>={open:'Abrir turno',produce:'Agregar producción',replenish:'Ingresar al mostrador',addWaiters:'Agregar más mozos',replaceWaiter:'Cambiar mozo',correctLotDate:'Modificar fecha de producción',adjustReserve:'Ajustar unidades',correctProduction:'Corregir producción'};
const dateLabel=(date:string)=>new Date(`${date}T12:00:00-05:00`).toLocaleDateString('es-PE',{dateStyle:'medium',timeZone:'America/Lima'});

export function OperationDialog({kind,state,productId,busy,serverError,onSave,onClose}:{kind:OperationKind;state:State;productId:string;busy:boolean;serverError:string;onSave:(data:Record<string,unknown>,message:string)=>Promise<boolean>;onClose:()=>void}){
  const latest=state.shifts.at(-1), active=state.shifts.find(shift=>shift.status==='open');
  const initialPeriod=latest?.period==='Mañana'&&latest.date===limaDate()?'Tarde':'Mañana';
  const [period,setPeriod]=useState<'Mañana'|'Tarde'>(initialPeriod);
  const [names,setNames]=useState<string[]>(Array(initialPeriod==='Tarde'&&kind==='open'?2:1).fill(''));
  const [quantities,setQuantities]=useState<Record<string,string>>({});
  const reserveTotal=state.lots.filter(l=>l.productId===productId).reduce((n,l)=>n+l.quantity,0);
  const [reserveCount,setReserveCount]=useState(String(reserveTotal));
  const [error,setError]=useState('');
  const [lotId,setLotId]=useState('');
  const datesAtOpen=useRef(new Map(state.lots.map(l=>[l.id,l.producedAt])));
  const [correctedDate,setCorrectedDate]=useState<string|undefined>();
  const [outgoing,setOutgoing]=useState(active?shiftTeam(active)[0]??'':'');
  const [replacement,setReplacement]=useState('');
  const dialogRef=useRef<HTMLElement>(null);
  const busyRef=useRef(busy);busyRef.current=busy;
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const requestRef=useRef<{payload:string;id:string}|null>(null);
  const team=active?shiftTeam(active):[];
  const selectedProduct=state.products.find(product=>product.id===productId);
  const productLots=state.lots.filter(lot=>lot.productId===productId).toReversed();
  const chosenLot=productLots.find(lot=>lot.id===lotId)||productLots[0];
  const dateChanged=kind==='correctLotDate'&&!!chosenLot&&chosenLot.producedAt!==datesAtOpen.current.get(chosenLot.id);
  const originalQuantity=chosenLot?.producedQuantity??(chosenLot?state.movements.filter(movement=>movement.productId===productId&&movement.lotId===chosenLot.id&&movement.type==='Producción').reduce((sum,movement)=>sum+movement.quantity,0):0);
  const available=(id:string)=>state.replenishment?.find(item=>item.productId===id)?.maximum??(state.products.find(p=>p.id===id)?.category==='Bollería'?bakedQuantity(state,id):state.lots.filter(lot=>lot.productId===id).reduce((sum,lot)=>sum+lot.quantity,0));
  const formProducts=state.products.filter(product=>(kind==='produce'||kind==='correctProduction'||!isKitchenProduct(product))&&(kind==='produce'?product.active!==false:kind==='replenish'?product.active!==false||active?.rows.some(row=>row.productId===product.id):product.active!==false));
  const entered=formProducts.flatMap(product=>{const raw=quantities[product.id]??'';return raw.trim()!==''&&Number(raw)!==0?[{productId:product.id,quantity:Number(raw)}]:[];});
  const total=entered.reduce((sum,item)=>sum+item.quantity,0);
  const maxNames=kind==='addWaiters'?4-team.length:4;
  const minimum=kind==='open'&&period==='Tarde'?2:1;
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const dialog=dialogRef.current;
    (dialog?.querySelector<HTMLElement>(`[data-product="${productId}"]`)??dialog?.querySelector<HTMLElement>('form input:not([type="hidden"]),form select,form button'))?.focus();
    function trap(event:KeyboardEvent){
      if(event.key==='Escape'&&!busyRef.current){event.preventDefault();closeRef.current();return;}
      if(event.key!=='Tab')return;
      const fields=[...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[])];
      const first=fields[0],last=fields.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);document.body.style.overflow=previousOverflow;previous?.focus();};
  },[kind,productId]);
  function choosePeriod(next:'Mañana'|'Tarde'){
    setPeriod(next);setNames(previous=>{const filled=previous.filter(Boolean);const count=Math.max(next==='Tarde'?2:1,filled.length);return Array.from({length:count},(_,index)=>filled[index]??'');});
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setError('');
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    let data:Record<string,unknown>;
    let message='Registro guardado.';
    if(kind==='open'||kind==='addWaiters'){
      const chosen=names.filter(Boolean);
      if(chosen.length<minimum||chosen.length>maxNames||new Set(chosen).size!==chosen.length){setError(`Selecciona ${minimum===2?'al menos dos mozos':'al menos un mozo'}, sin repetir nombres.`);return;}
      if(kind==='open'){
        data={type:'open',date:fields.date,period,responsibles:chosen,openings:Object.fromEntries(Object.entries(fields).filter(([key])=>key.startsWith('initial:')).map(([key,value])=>[key.slice(8),Number(value)]))};
        message='Turno abierto. El equipo quedó registrado para los ingresos y el cierre.';
      }else{data={type:'addWaiters',names:chosen};message='Mozos agregados al equipo del turno.';}
    }else if(kind==='replaceWaiter'){
      if(!active||!team.includes(outgoing)||!replacement||team.includes(replacement)){setError('Selecciona al mozo del turno y un reemplazo que no esté en el equipo.');return;}
      if(!String(fields.reason??'').trim()){setError('Escribe el motivo del cambio.');return;}
      data={type:'replaceWaiter',shiftId:active.id,outgoing,replacement,reason:String(fields.reason).trim()};message='Mozo reemplazado. El cierre usará el equipo actualizado.';
    }else if(kind==='produce'||kind==='replenish'){
      if(!entered.length){setError('Escribe una cantidad en al menos un producto.');return;}
      const invalid=entered.find(item=>!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100000||(kind==='replenish'&&item.quantity>available(item.productId)));
      if(invalid){setError(`Revisa la cantidad de ${state.products.find(product=>product.id===invalid.productId)?.name}.`);return;}
      data={type:kind==='produce'?'produceBatch':'replenishBatch',items:entered,...(kind==='produce'?{date:fields.date,responsible:fields.responsible}:{})};
      message=kind==='produce'?`Producción guardada: ${total} unidades en ${entered.length} productos.`:`Ingresos guardados: ${total} unidades en ${entered.length} productos. La reserva quedó actualizada.`;
    }else if(kind==='adjustReserve'){
      const quantity=Number(reserveCount);
      if(!reserveCount.trim()||!Number.isSafeInteger(quantity)||quantity<0||quantity>100000){setError('Total correcto: ingresa un entero entre 0 y 100000.');return;}
      if(quantity===reserveTotal){setError('No hay cambios para guardar.');return;}
      if(!String(fields.reason??'').trim()){setError('Escribe el motivo del ajuste.');return;}
      data={type:'adjustReserve',productId,quantity,responsible:fields.responsible,reason:String(fields.reason).trim()};
      message='Unidades ajustadas. La reserva y el historial están actualizados.';
    }else if(kind==='correctLotDate'){
      if(!chosenLot){setError('No hay un lote registrado para corregir.');return;}
      if(dateChanged){setError('Los datos cambiaron en este lote. Cierra y vuelve a abrir el formulario.');return;}
      const date=String(fields.date??'');
      if(date<'0001-01-01'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>limaDate()){setError('Fecha de producción inválida o futura.');return;}
      if(date===chosenLot.producedAt){setError('No hay cambios para guardar.');return;}
      data={type:'correctLotDate',lotId:chosenLot.id,expectedDate:datesAtOpen.current.get(chosenLot.id),date,reason:fields.reason,responsible:fields.responsible};
      message='Fecha de producción corregida. El historial quedó actualizado.';
    }else{
      if(!chosenLot){setError('No hay una producción registrada para corregir.');return;}
      data={type:'correctProduction',lotId:chosenLot.id,quantity:Number(fields.quantity),reason:fields.reason,responsible:fields.responsible};
      message='Producción corregida. La reserva y el historial están actualizados.';
    }
    const payload=JSON.stringify(data);
    if(requestRef.current?.payload!==payload)requestRef.current={payload,id:crypto.randomUUID()};
    if(await onSave({...data,operationId:requestRef.current!.id},message))onClose();
  }
  return <div className="modal-backdrop"><section className={`modal operation-modal ${kind==='produce'||kind==='replenish'?'batch-modal':''}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <div className="modal-header"><div><div className="eyebrow">LUNE · INVENTARIO</div><h2 id="operation-title">{titles[kind]}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Cerrar formulario"><X size={20}/></button></div>
    <form onSubmit={submit}><fieldset className="operation-fields" disabled={busy}><div className="operation-scroll">
      {(kind==='open'||kind==='addWaiters')&&<>
        {kind==='open'?<div className="form-grid"><label>Fecha<input required name="date" type="date" max={limaDate()} defaultValue={limaDate()}/></label><label>Turno<select value={period} onChange={event=>choosePeriod(event.target.value as typeof period)}><option>Mañana</option><option>Tarde</option></select></label></div>:<p className="form-note">Equipo actual: {team.join(', ')}. Puedes agregar hasta {maxNames} {maxNames===1?'mozo más':'mozos más'}.</p>}
        <div className="team-fields">{names.map((value,index)=><label key={index}>Mozo {kind==='addWaiters'?team.length+index+1:index+1}<div className="team-field"><select value={value} required={index<minimum} aria-label={`Mozo ${index+1}`} onChange={event=>setNames(previous=>previous.map((name,i)=>i===index?event.target.value:name))}><option value="">Selecciona un mozo</option>{WAITERS.filter(name=>!team.includes(name)||kind==='open').map(name=><option key={name} disabled={names.some((selected,i)=>i!==index&&selected===name)}>{name}</option>)}</select>{index>=minimum&&<button className="icon-button" type="button" disabled={busy} aria-label={`Quitar campo de mozo ${index+1}`} onClick={()=>setNames(previous=>previous.filter((_,i)=>i!==index))}><X size={16}/></button>}</div></label>)}</div>
        <button className="secondary" type="button" disabled={busy||names.length>=maxNames} onClick={()=>setNames(previous=>[...previous,''])}><Plus size={16}/>Agregar más mozos</button>
        <p className="form-note">{kind==='open'?`${period==='Tarde'?'La tarde requiere al menos dos mozos':'La mañana requiere al menos un mozo'}. Máximo cuatro responsables por turno. Los nombres se usarán automáticamente en los ingresos y en el cierre.`:'Todos los integrantes quedarán asociados al turno y al cierre.'}</p>
        {kind==='open'&&(latest?<p className="form-note">La entrada se toma del cierre de {latest.period.toLowerCase()} del {dateLabel(latest.date)}.</p>:<><p className="form-note">Primer turno: cuenta las unidades que ya están en el mostrador.</p><div className="initial-counts">{formProducts.map(product=><label key={product.id}>{product.name}<ManualCountInput name={`initial:${product.id}`} min="0" max="100000" step="1" required defaultValue="0"/></label>)}</div></>)}
      </>}
      {kind==='replaceWaiter'&&<>
        <p className="form-note">Equipo actual: <strong>{team.join(', ')||'Sin turno abierto'}</strong>. Puedes reemplazar a quien no asistió mientras el turno esté abierto.</p>
        <label>Mozo que no asistió<select name="outgoing" required value={outgoing} onChange={event=>setOutgoing(event.target.value)}><option value="" disabled>Selecciona un mozo del turno</option>{team.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Mozo que lo reemplaza<select name="replacement" required value={replacement} onChange={event=>setReplacement(event.target.value)}><option value="" disabled>Selecciona al reemplazo</option>{WAITERS.filter(name=>!team.includes(name)).map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Motivo del cambio<input name="reason" required maxLength={180} placeholder="Ej. No asistió y lo reemplaza otro mozo"/></label>
        {replacement&&<p className="form-note">Equipo actualizado: <strong>{team.map(name=>name===outgoing?replacement:name).join(', ')}</strong>. Estos nombres se usarán al cerrar el turno. El cambio quedará registrado en el historial.</p>}
      </>}
      {(kind==='produce'||kind==='replenish')&&<>
        {kind==='produce'?<div className="form-grid"><label>Cocinero<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{COOKS.map(name=><option key={name}>{name}</option>)}</select></label><label>Fecha de producción<input name="date" type="date" required max={limaDate()} defaultValue={limaDate()}/></label></div>:<p className="form-note">Escribe las unidades que ingresan al mostrador. El sistema descontará primero la producción más antigua disponible.</p>}
        <div className="batch-products"><div className={`batch-list-heading ${kind==='produce'?'production-row':''}`}><span>Producto</span>{kind==='replenish'&&<span>Disponibles para ingresar</span>}<span>{kind==='produce'?'Producidas':'A ingresar'}</span></div>{formProducts.map(product=><label className={`batch-product-row ${kind==='produce'?'production-row':''}`} key={product.id}><span>{product.name}{kind==='replenish'&&product.category==='Bollería'&&<small>Horneados en cocina</small>}</span>{kind==='replenish'&&<span className="batch-stock">{available(product.id)} uds.</span>}<ManualCountInput disabled={kind==='replenish'&&available(product.id)===0} title={kind==='replenish'&&available(product.id)===0?'Sin reserva disponible':undefined} data-product={product.id} aria-label={`${kind==='produce'?'Producción':'Ingreso al mostrador'} de ${product.name}`} min="0" max={kind==='produce'?100000:available(product.id)} step="1" placeholder="0" value={quantities[product.id]??''} onChange={event=>setQuantities(previous=>({...previous,[product.id]:event.target.value}))}/></label>)}</div>
        <p className="batch-total"><strong>{entered.length} productos · {total} unidades</strong><span>Los campos vacíos o en cero no generan movimientos.</span></p>
      </>}
      {kind==='adjustReserve'&&<>
        <p className="form-note"><strong>{selectedProduct?.name}</strong>. Escribe el total contado en reserva congelada.</p>
        <p className="form-note">Total actual: <strong>{reserveTotal}</strong> unidades.</p>
        <label>Total correcto<ManualCountInput name="quantity" required min="0" max="100000" step="1" value={reserveCount} onChange={event=>setReserveCount(event.target.value)}/></label>
        {reserveCount.trim()&&Number.isSafeInteger(Number(reserveCount))&&Number(reserveCount)>=0&&Number(reserveCount)<=100000&&<p className="form-note" aria-live="polite">Disponibles: <strong>{reserveTotal} → {Number(reserveCount)}</strong>. Ajuste: <strong>{Number(reserveCount)>reserveTotal?'+':''}{Number(reserveCount)-reserveTotal}</strong> unidades.</p>}
        <label>Cocinero responsable<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{COOKS.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Motivo del ajuste<input name="reason" required maxLength={180} placeholder="Ej. Corrección del conteo físico"/></label>
        <p className="form-note">El ajuste conserva la producción registrada y las ventas calculadas.</p>
      </>}
      {kind==='correctLotDate'&&<>
        <p className="form-note"><strong>{selectedProduct?.name}</strong>. Selecciona el lote cuya fecha de producción necesitas corregir.</p>
        <label>Lote<select name="lotId" value={chosenLot?.id??''} disabled={!productLots.length} onChange={event=>{setLotId(event.target.value);setCorrectedDate(undefined);setError('');}}>{!productLots.length&&<option value="">Sin lotes registrados</option>}{productLots.map(lot=><option key={lot.id} value={lot.id}>{dateLabel(lot.producedAt)} · {lot.producedQuantity??lot.quantity} producidas · {lot.quantity} disponibles{lot.quantity===0?' · Agotado':''}</option>)}</select></label>
        {chosenLot&&<><p className="form-note">Fecha actual: <strong>{dateLabel(chosenLot.producedAt)}</strong>. {chosenLot.producedQuantity??chosenLot.quantity} producidas · {chosenLot.quantity} disponibles.</p><label>Fecha de producción correcta<input name="date" type="date" required min="0001-01-01" max={limaDate()} value={correctedDate??datesAtOpen.current.get(chosenLot.id)??chosenLot.producedAt} onChange={event=>setCorrectedDate(event.target.value)}/></label>{correctedDate&&/^\d{4}-\d{2}-\d{2}$/.test(correctedDate)&&Number.isFinite(Date.parse(correctedDate))&&<p className="form-note">Fecha de producción: <strong>{dateLabel(datesAtOpen.current.get(chosenLot.id)??chosenLot.producedAt)} → {dateLabel(correctedDate)}</strong>.</p>}</>}
        <label>Cocinero que corrige<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{COOKS.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Motivo de la corrección<input name="reason" required maxLength={180} placeholder="Ej. La producción fue del día anterior"/></label>
        <p className="form-note">La nueva fecha se usará para los próximos retiros de reserva. Se conservan las cantidades, los retiros y los horneados ya registrados.</p>
        {dateChanged&&<p className="alert error" role="alert">La fecha de este lote cambió en otra sesión. Cierra y vuelve a abrir el formulario.</p>}
      </>}
      {kind==='correctProduction'&&<>
        <p className="form-note"><strong>{selectedProduct?.name}</strong>. Elige el registro por fecha y cantidad. Se conserva el historial de la corrección.</p>
        <label>Producción registrada<select value={chosenLot?.id??''} onChange={event=>setLotId(event.target.value)} disabled={!productLots.length}>{!productLots.length&&<option value="">Sin producción registrada</option>}{productLots.map((lot,index)=><option key={lot.id} value={lot.id}>{dateLabel(lot.producedAt)} · {lot.producedQuantity??lot.quantity} producidas · {lot.quantity} en reserva{index===0?' · Más reciente':''}</option>)}</select></label>
        {chosenLot&&<><p className="form-note">Cantidad registrada: <strong>{originalQuantity}</strong> unidades. Disponibles en reserva: <strong>{chosenLot.quantity}</strong>.</p><label>Cantidad producida correcta<ManualCountInput key={chosenLot.id} name="quantity" min={Math.max(0,originalQuantity-chosenLot.quantity)} max="100000" step="1" required defaultValue={originalQuantity}/></label></>}
        <label>Cocinero que corrige<select name="responsible" required defaultValue=""><option value="" disabled>Selecciona tu nombre</option>{COOKS.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Motivo de la corrección<input name="reason" required maxLength={180} placeholder="Ej. Se registraron 15 y se prepararon 12"/></label>
      </>}
      {(error||serverError)&&<div className="alert error" role="alert">{error||serverError}</div>}
      </div>
      <div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||(kind==='correctLotDate'&&(!chosenLot||dateChanged))||(kind==='addWaiters'&&maxNames<1)||(kind==='correctProduction'&&!chosenLot)||(kind==='replaceWaiter'&&(!active||!outgoing||!replacement))}>{busy?'Guardando…':kind==='produce'?'Guardar producción':kind==='replenish'?'Guardar ingresos':kind==='open'?'Abrir turno':kind==='addWaiters'?'Agregar al turno':kind==='replaceWaiter'?'Guardar cambio':kind==='adjustReserve'?'Guardar ajuste':kind==='correctLotDate'?'Guardar fecha':'Guardar corrección'}<Check size={16}/></button></div>
    </fieldset></form>
  </section></div>;
}
