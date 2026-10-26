'use client';
import {ManualCountInput} from './manual-count-input';
import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { limaDate, type State } from '@/lib/inventory';
import { excelDate, detectColumns, matchingProduct, matrixDrafts, previewExcel, tableDrafts, type ExcelSheet, type ImportField, type ImportMap } from '@/lib/excel-preview';
const fields:Record<ImportField,string>={product:'Producto',date:'Fecha',period:'Turno',opening:'Entrada inicial',incoming:'Ingreso nuevo',closing:'Salida de turno / cierre',sold:'Ventas (para comprobar)',produced:'Moldes producidos',used:'Moldes usados',quantity:'Saldo final (para comprobar)'};
export function ExcelImportWorkspace({state,busy,onCommand}:{state:State;busy:boolean;onCommand:(data:Record<string,unknown>,message:string)=>Promise<boolean>}) {
  const [sheets,setSheets]=useState<ExcelSheet[]>([]),[filename,setFilename]=useState(''),[sheetIndex,setSheetIndex]=useState(0);
  const [kind,setKind]=useState<'turno'|'reserva'>('turno'),[format,setFormat]=useState<'matriz'|'tabla'>('matriz');
  const [headerText,setHeaderText]=useState('1');
  const [header,setHeader]=useState(0),[columns,setColumns]=useState<ImportMap>(detectColumns([]));
  const [products,setProducts]=useState<Record<string,string>>({}),[date,setDate]=useState(''),[period,setPeriod]=useState('');
  const [importedBy,setImportedBy]=useState(''),[reading,setReading]=useState(false),[error,setError]=useState('');
  const [historyKind,setHistoryKind]=useState('Todos');
  const [historyQuery,setHistoryQuery]=useState(''),[historyFrom,setHistoryFrom]=useState(''),[historyTo,setHistoryTo]=useState('');
  const [historyPage,setHistoryPage]=useState(0),[previewPage,setPreviewPage]=useState(0);
  const [importFrom,setImportFrom]=useState(''),[importTo,setImportTo]=useState(limaDate());
  const sheet=sheets[sheetIndex];
  const allDrafts=useMemo(()=>!sheet?[]:format==='matriz'?matrixDrafts(sheet,kind):tableDrafts(sheet,header,columns),[sheet,format,kind,header,columns]);
  const drafts=useMemo(()=>allDrafts.filter(row=>{
    try {const day=excelDate(row.date===null||String(row.date).trim()===''?date:row.date,sheet?.date1904??false,true);return (!importFrom||day>=importFrom)&&(!importTo||day<=importTo);}
    catch{return true;}
  }),[allDrafts,date,sheet?.date1904,importFrom,importTo]);
  const names=[...new Set(drafts.map(row=>row.name))];
  const preview=useMemo(()=>previewExcel(drafts,state,kind,{products,date,period,date1904:sheet?.date1904 ?? false}),[drafts,state,kind,products,date,period,sheet?.date1904]);
  function selectSheet(index:number){setSheetIndex(index);setProducts({});setHeader(0);setHeaderText('1');setColumns(detectColumns(sheets[index]?.rows[0]??[]));}
  async function read(file:File|undefined) {
    if(!file)return;
    setError('');setReading(true);setSheets([]);setProducts({});
    try{
      if(file.size>5_000_000)throw new Error('El Excel supera 5 MB.');
      const form=new FormData();form.set('file',file);
      const response=await fetch('/api/imports/excel/preview',{method:'POST',body:form});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setFilename(result.filename);setSheets(result.sheets);setSheetIndex(0);setHeader(0);setHeaderText('1');setColumns(detectColumns(result.sheets[0]?.rows[0]??[]));
    }catch(e){setError((e as Error).message);}finally{setReading(false);}
  }
  async function save(){
    if(format==='tabla'&&(!headerText||Number(headerText)<1||Number(headerText)>(sheet?.rows.length??0)))return;
    if(busy||reading||!preview.records.length||preview.errors.length||!importedBy.trim())return;
    const ok=await onCommand({type:'excelImport',filename,importedBy,records:preview.records},`${preview.records.length} registros históricos importados. Los saldos actuales se conservan.`);
    if(ok){setSheets([]);setFilename('');setProducts({});}
  }
  const history=(state.excelImports??[]).flatMap(batch=>batch.records.map(record=>({...record,filename:batch.filename,importedBy:batch.importedBy}))).filter(row=>(historyKind==='Todos'||row.kind===historyKind)&&(!historyFrom||row.date>=historyFrom)&&(!historyTo||row.date<=historyTo)&&(state.products.find(product=>product.id===row.productId)?.name??'').toLocaleLowerCase('es').includes(historyQuery.toLocaleLowerCase('es'))).sort((a,b)=>b.date.localeCompare(a.date)||(a.period===b.period?0:a.period==='Tarde'?-1:1));
  const historyPages=Math.max(1,Math.ceil(history.length/50)),historyCurrent=Math.min(historyPage,historyPages-1);
  const previewPages=Math.max(1,Math.ceil(preview.records.length/50)),previewCurrent=Math.min(previewPage,previewPages-1);
  return <>
    <section className="panel excel-panel"><div className="panel-heading"><div><h2><Upload size={20}/> Importar historial de Excel</h2><p>Solo postres. Revisa la vista previa antes de guardar cada hoja.</p></div></div>
      <p className="sales-note">El historial de mostrador se incorpora a Historial y Ventas por turno. La reserva conserva entradas, producción, usados y saldo por turno, contados como moldes del archivo. No crea ventas de reserva ni modifica el inventario actual. Para empezar la operación, registra un conteo físico actual.</p>
      <fieldset disabled={busy||reading} className="excel-controls"><label>Archivo Excel (.xlsx, hasta 5 MB)<input type="file" accept=".xlsx" onChange={e=>void read(e.target.files?.[0])}/></label><label>Contenido<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setProducts({});}}><option value="turno">Mostrador: postres por turno</option><option value="reserva">Reserva: moldes producidos y usados</option></select></label><label>Quien realiza la importación<input value={importedBy} onChange={e=>setImportedBy(e.target.value)} maxLength={80} placeholder="Tu nombre"/></label></fieldset>
      {reading&&<p className="sales-note" role="status">Leyendo Excel…</p>}{error&&<p className="alert error" role="alert">{error}</p>}
      {sheet&&<>
        <fieldset disabled={busy} className="excel-controls"><label>Importar desde (opcional)<input type="date" value={importFrom} onChange={e=>{setImportFrom(e.target.value);setPreviewPage(0);}}/></label><label>Importar hasta<input type="date" value={importTo} onChange={e=>{setImportTo(e.target.value);setPreviewPage(0);}}/></label></fieldset>
        <p className="sales-note">{allDrafts.length-drafts.length} registros fuera del rango elegido. Por defecto se incluyen fechas hasta hoy para excluir las casillas futuras de la plantilla mensual.</p>
        <fieldset disabled={busy||reading} className="excel-controls"><label>Hoja<select value={sheetIndex} onChange={e=>selectSheet(Number(e.target.value))}>{sheets.map((item,index)=><option key={item.name} value={index}>{item.name}</option>)}</select></label><label>Estructura<select value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="matriz">Bloques por producto y fechas a la derecha (Lune)</option><option value="tabla">Una fila por producto, fecha y turno</option></select></label><label>Fecha si el bloque no la indica<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Turno si el bloque no lo indica<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Seleccionar si hace falta</option><option>Mañana</option><option>Tarde</option></select></label></fieldset>
        {format==='tabla'&&<fieldset disabled={busy} className="excel-controls"><label>Fila de encabezados<ManualCountInput min="1" max={sheet.rows.length} value={headerText} onChange={e=>{setHeaderText(e.target.value);const row=Number(e.target.value)-1;if(Number.isSafeInteger(row)&&row>=0&&row<sheet.rows.length){setHeader(row);setColumns(detectColumns(sheet.rows[row]??[]));}}}/></label>{(['product','date','period','opening',...(kind==='turno'?['incoming','closing','sold']:['produced','used','quantity'])] as ImportField[]).map(field=><label key={field}>{fields[field]}<select value={columns[field]} onChange={e=>setColumns({...columns,[field]:Number(e.target.value)})}><option value="-1">Sin columna seleccionada</option>{['incoming','produced','used'].includes(field)&&<option value="-2">No hubo movimientos (0)</option>}{(sheet.rows[header]??[]).map((value,index)=><option key={index} value={index}>{index+1}: {String(value??'Sin título')}</option>)}</select></label>)}</fieldset>}
        <details className="excel-source"><summary>Ver celdas originales (primeras 30 filas)</summary><div className="table-wrap"><table><tbody>{sheet.rows.slice(0,30).map((row,index)=><tr key={index}><th>{index+1}</th>{row.map((value,c)=><td key={c}>{value??''}</td>)}</tr>)}</tbody></table></div></details>
        <div className="excel-matches"><h3>Asociar nombres con el catálogo</h3><p>Se reconocen diferencias de tildes y mayúsculas. Los nombres distintos requieren tu elección. Omite los croissants y rolls, ya que esta importación es solo de postres.</p><fieldset disabled={busy} className="excel-controls">{names.map(name=><label key={name}>{name||'(Sin nombre)'}<select value={products[name]??matchingProduct(name,state.products)} onChange={e=>setProducts({...products,[name]:e.target.value})}><option value="">Selecciona un postre</option><option value="__skip">Omitir estas filas</option>{state.products.filter(p=>p.category==='Postres').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</fieldset></div>
        <div className="panel-heading"><div><h3>Vista previa</h3><p>{preview.records.length} registros · {preview.omitted} omitidos por tu elección · {preview.errors.length} incidencias</p></div></div>
        {!!preview.errors.length&&<div className="excel-errors" role="alert"><strong>Corrige estas incidencias antes de importar.</strong><ul>{preview.errors.slice(0,30).map((issue,index)=><li key={index}>{issue}</li>)}</ul>{preview.errors.length>30&&<p>Se muestran las primeras 30 incidencias.</p>}</div>}
        {!drafts.length&&<p className="sales-note">No se encontraron bloques. Revisa la hoja o cambia a una fila por producto.</p>}
        <div className="table-wrap" role="region" aria-label="Vista previa del Excel" tabIndex={0}><table><thead><tr><th>FILA</th><th>FECHA</th><th>TURNO</th><th>POSTRE</th><th>ENTRADA</th><th>{kind==='turno'?'INGRESO NUEVO':'PRODUCIDOS'}</th><th>{kind==='turno'?'CIERRE':'USADOS'}</th><th>{kind==='turno'?'VENTAS':'SALDO'}</th></tr></thead><tbody>{preview.records.slice(previewCurrent*50,previewCurrent*50+50).map((row,index)=><tr key={index}><td>{row.row}</td><td>{row.date}</td><td>{row.period}</td><td>{state.products.find(p=>p.id===row.productId)?.name}</td><td>{row.opening}</td><td>{row.kind==='turno'?row.incoming:row.produced}</td><td>{row.kind==='turno'?row.closing:row.used}</td><td>{row.kind==='turno'?row.opening+row.incoming-row.closing:row.quantity}</td></tr>)}</tbody></table></div>
        <div className="excel-pagination"><button className="secondary" disabled={!previewCurrent} onClick={()=>setPreviewPage(previewCurrent-1)}>Anterior</button><span>Vista previa {previewCurrent+1} de {previewPages}</span><button className="secondary" disabled={previewCurrent>=previewPages-1} onClick={()=>setPreviewPage(previewCurrent+1)}>Siguiente</button></div>
        <div className="excel-save"><p>Se guardarán {preview.records.length} registros de «{sheet.name}». Revisa todas las páginas. No se reemplazan registros existentes.</p><button className="primary" disabled={format==='tabla'&&(!headerText||Number(headerText)<1||Number(headerText)>(sheet?.rows.length??0))||busy||reading||!preview.records.length||!!preview.errors.length||!importedBy.trim()} onClick={()=>void save()}>{busy?'Guardando…':'Confirmar importación del historial'}</button></div>
      </>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Historial importado</h2><p>{history.length} registros para los filtros elegidos. Los moldes de reserva son datos históricos del Excel.</p></div></div>
      <div className="supply-toolbar"><label>Sección<select value={historyKind} onChange={e=>{setHistoryKind(e.target.value);setHistoryPage(0);}}><option>Todos</option><option value="turno">Mostrador</option><option value="reserva">Reserva congelada</option></select></label><label>Postre<input placeholder="Buscar por nombre" value={historyQuery} onChange={e=>{setHistoryQuery(e.target.value);setHistoryPage(0);}}/></label><label>Desde<input type="date" value={historyFrom} onChange={e=>{setHistoryFrom(e.target.value);setHistoryPage(0);}}/></label><label>Hasta<input type="date" value={historyTo} onChange={e=>{setHistoryTo(e.target.value);setHistoryPage(0);}}/></label></div>
      <div className="table-wrap" role="region" aria-label="Historial de Excel" tabIndex={0}><table><thead><tr><th>FECHA / TURNO</th><th>POSTRE / SECCIÓN</th><th>ENTRADA</th><th>INGRESOS / PRODUCIDOS</th><th>CIERRE / USADOS</th><th>VENTAS / SALDO</th><th>ORIGEN</th></tr></thead><tbody>{history.slice(historyCurrent*50,historyCurrent*50+50).map((row,index)=><tr key={index}><td>{row.date}<br/>{row.period}</td><td>{state.products.find(p=>p.id===row.productId)?.name}<br/><small>{row.kind==='turno'?'Mostrador (unidades)':'Reserva (moldes)'}</small></td><td>{row.opening}</td><td>{row.kind==='turno'?row.incoming:row.produced}</td><td>{row.kind==='turno'?row.closing:row.used}</td><td>{row.kind==='turno'?row.opening+row.incoming-row.closing:row.quantity}</td><td>{row.filename}<br/><small>{row.sheet} · fila {row.row} · importó {row.importedBy}</small></td></tr>)}</tbody></table>{!history.length&&<div className="empty">No hay registros con estos filtros.</div>}</div>
      <div className="excel-pagination"><button className="secondary" disabled={!historyCurrent} onClick={()=>setHistoryPage(historyCurrent-1)}>Anterior</button><span>Página {historyCurrent+1} de {historyPages}</span><button className="secondary" disabled={historyCurrent>=historyPages-1} onClick={()=>setHistoryPage(historyCurrent+1)}>Siguiente</button></div>
    </section>
  </>;
}
