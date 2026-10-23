'use client';
import {useEffect,useState} from 'react';
type Backup={id:string;shiftId:number;revision:number;date:string;period:string;reason:string;createdAt:string;status:string;attempts:number;errorCode:string|null;savedAt:string|null;bytes:number|null;sha256:string};
type Summary={enabled:boolean;pending:number;saved:number;backups:Backup[]};
const time=(value:string)=>new Intl.DateTimeFormat('es-PE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));
export function BackupsPanel(){
  const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){
    try{const r=await fetch('/api/admin/backups',{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudieron consultar los respaldos.');setSummary(data);setError('');}
    catch(e){setError((e as Error).message);}
  }
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},20000);return()=>clearInterval(timer);},[]);
  async function retry(){
    setBusy(true);setError('');
    try{const r=await fetch('/api/admin/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry'})});const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudo reintentar.');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <>
    {error&&<p role="alert" className="alert error">{error}</p>}
    {!summary?<p>Cargando respaldos…</p>:<>
      <p role="status"><strong>{summary.saved} guardados · {summary.pending} pendientes</strong></p>
      {!summary.enabled&&<p className="alert">Los respaldos automáticos no están activados en este entorno.</p>}
      {summary.pending>0&&<p className="alert">Los cierres están guardados. Hay copias pendientes de envío; se reintentan automáticamente.</p>}
      <div className="heading-actions"><button className="secondary" disabled={busy} onClick={refresh}>Actualizar</button><button className="primary" disabled={busy||!summary.pending} onClick={retry}>{busy?'Reintentando…':'Reintentar una copia pendiente'}</button></div>
      <section className="panel" style={{marginTop:20}}><div className="table-wrap"><table><thead><tr><th>Turno</th><th>Tipo</th><th>Estado</th><th>Guardado</th><th>Copia</th></tr></thead><tbody>{summary.backups.map(item=><tr key={item.id}>
        <td>{item.date} · {item.period==='manana'?'Mañana':'Tarde'}<small style={{display:'block'}}>Turno {item.shiftId} · revisión {item.revision}</small></td>
        <td>{item.reason==='cierre'?'Cierre':'Corrección'}</td>
        <td>{item.status==='guardado'?'Guardado y verificado':'Pendiente de envío'}{item.errorCode&&<small style={{display:'block'}}>No se pudo subir la copia. Se reintentará. ({item.errorCode})</small>}</td>
        <td>{item.savedAt?time(item.savedAt):'—'}</td>
        <td>{item.status==='guardado'?<a href={`/api/admin/backups?download=${item.id}`}>Descargar</a>:'—'}</td>
      </tr>)}</tbody></table></div>{!summary.backups.length&&<p style={{padding:20}}>La primera copia aparecerá al cerrar el próximo turno. Los cierres anteriores no se reconstruyen como si fueran respaldos de ese momento.</p>}</section>
      <p>Se muestran las últimas 100 copias. Las anteriores permanecen guardadas en Storage → lune-cierres. No se eliminan automáticamente.</p>
      <p>Estas copias contienen datos operativos; no incluyen contraseñas ni sesiones de acceso. La recuperación se realiza con asistencia técnica. Eliminar el proyecto de Supabase también elimina este espacio de copias.</p>
    </>}
  </>;
}
