import { excelConflicts, validateExcelRecords, type ExcelRecord } from './excel-history';
import { limaDate, type Product, type State } from './inventory';
export type ExcelCell = string | number | null;
export type ExcelSheet = { name:string; rows:ExcelCell[][]; date1904:boolean };
export type ImportField = 'product'|'date'|'period'|'opening'|'incoming'|'closing'|'sold'|'produced'|'used'|'quantity';
export type ImportMap = Record<ImportField,number>;
export type DraftExcelRow = { name:string; date:ExcelCell; period:ExcelCell; row:number; sheet:string; values:Partial<Record<ImportField,ExcelCell>>; issues?:string[] };
export const normalizeExcel = (value:unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const aliases: Record<ImportField,string[]> = {
  product:['producto','postre','nombre','nombre producto','nombre del producto'], date:['fecha','dia'], period:['turno','periodo'],
  opening:['entrada','inicial','stock inicial','saldo inicial'], incoming:['ingreso nuevo','ingresos','ingreso','ingresos nuevos'],
  closing:['salida turno','salida de turno','cierre','conteo cierre','stock al cierre'], sold:['ventas','vendidos','venta'],
  produced:['produccion','producidos','moldes producidos','elaborados','ingreso nuevo','ingresos'], used:['usados','utilizados','retiros','moldes usados','salidas','salida turno'],
  quantity:['saldo','stock final','saldo final','restantes','stock','cantidad restante'],
};
export function detectColumns(row:ExcelCell[]): ImportMap {
  return Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,row.findIndex(cell=>names.includes(normalizeExcel(cell)))])) as ImportMap;
}
export function excelDate(value:ExcelCell,date1904=false,allowFuture=false): string {
  let date='';
  if(typeof value==='number' && value>=1 && value<100000) date=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.floor(value)*86400000).toISOString().slice(0,10);
  else {
    const raw=String(value ?? '').trim();
    const short=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    const long=normalizeExcel(raw).match(/(?:^| )(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre) de (\d{4})$/);
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) date=raw;
    else if(short) date=`${short[3]}-${short[2].padStart(2,'0')}-${short[1].padStart(2,'0')}`;
    else if(long) { const month=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'].indexOf(long[2]==='setiembre'?'septiembre':long[2])+1; date=`${long[3]}-${String(month).padStart(2,'0')}-${long[1].padStart(2,'0')}`; }
  }
  if(!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || (!allowFuture && date>limaDate())) throw new Error('Fecha inválida o futura.');
  return date;
}
export function excelPeriod(value:ExcelCell): 'Mañana'|'Tarde' {
  const text=normalizeExcel(value);
  if(['manana','dia','turno dia','turno manana','am'].includes(text)) return 'Mañana';
  if(['tarde','turno tarde','pm'].includes(text)) return 'Tarde';
  throw new Error('Selecciona un turno válido.');
}
export function tableDrafts(sheet:ExcelSheet,header:number,map:ImportMap): DraftExcelRow[] {
  return sheet.rows.slice(header+1).flatMap((cells,index)=>{
    if(cells.every(cell=>cell===null || String(cell).trim()==='')) return [];
    const get=(field:ImportField)=>map[field]===-2 ? 0 : cells[map[field]] ?? null;
    return [{ name:String(get('product') ?? '').trim(), date:get('date'), period:get('period'), row:index+header+2, sheet:sheet.name, values:Object.fromEntries(Object.keys(map).map(field=>[field,get(field as ImportField)])) }];
  });
}

/** Reads the paired label/value columns and four-row product blocks used at Lune. */
export function matrixDrafts(sheet:ExcelSheet,kind:'turno'|'reserva'): DraftExcelRow[] {
  const records=new Map<string,DraftExcelRow>();
  let dates=new Map<number,string>(), period:ExcelCell=null, name='';
  const sheetName=normalizeExcel(sheet.name);
  if(sheetName.includes('tarde')) period='Tarde';
  else if(sheetName.includes('manana') || /\bdia\b/.test(sheetName)) period='Mañana';
  const metricFields:ImportField[]=kind==='turno'?['opening','incoming','closing','sold']:['opening','produced','used','quantity'];
  sheet.rows.forEach((cells,r)=>{
    const header=cells.map(normalizeExcel).find(value=>/turno (de )?(manana|dia|tarde)/.test(value) || /^postres (manana|tarde)$/.test(value));
    if(header) {period=header.includes('tarde')?'Tarde':'Mañana';name='';}
    const metrics=cells.map((cell,c)=>({field:metricFields.find(field=>aliases[field].includes(normalizeExcel(cell))),c})).filter(item=>item.field);
    if(!metrics.length) {
      const found=new Map<number,string>();
      cells.forEach((cell,c)=>{if(cell===null)return; if(typeof cell==='number' && cell<20000)return; try{found.set(c,excelDate(cell,sheet.date1904,true));}catch{if(typeof cell==='string' && (/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}/.test(cell)||/ de .* de \d{4}/i.test(cell)))found.set(c,cell);}});
      if(found.size) dates=found;
      return;
    }
    const first=String(cells[0] ?? '').trim();
    if(first && !metricFields.some(field=>aliases[field].includes(normalizeExcel(first))) && !header) name=first;
    for(const {field,c} of metrics) {
      const value=cells[c+1] ?? null;
      // Merged date headings occupy both label and value columns.
      const date=dates.get(c+1) ?? dates.get(c) ?? null;
      const key=`${name}|${date ?? `column${c}`}|${period}`;
      const item=records.get(key) ?? {name,date,period,row:r+1,sheet:sheet.name,values:{},issues:[]};
      if(field! in item.values && item.values[field!]!==null && item.values[field!]!=='') item.issues!.push(`El bloque repite ${field}; revisa encabezados y fechas.`);
      item.values[field!]=value;
      records.set(key,item);
    }
  });
  return [...records.values()].filter(item=>Object.values(item.values).some(value=>value!==null && String(value).trim()!==''));
}
export function matchingProduct(name:string,products:Product[]): string {
  const matches=products.filter(product=>product.category==='Postres' && normalizeExcel(product.name)===normalizeExcel(name));
  return matches.length===1 ? matches[0].id : '';
}
export function previewExcel(drafts:DraftExcelRow[],state:State,kind:'turno'|'reserva',options:{products:Record<string,string>;date:string;period:string;date1904:boolean}) {
  const records:ExcelRecord[]=[], errors:string[]=[];
  let omitted=0;
  const number=(value:ExcelCell | undefined,label:string)=>{
    if(value===null || value===undefined || String(value).trim()==='') throw new Error(`${label} está vacío.`);
    const n=typeof value==='number'?value:Number(String(value).trim());
    if(!Number.isSafeInteger(n) || n<0 || n>100000) throw new Error(`${label} debe ser un entero entre 0 y 100000.`);
    return n;
  };
  drafts.forEach(draft=>{
    const productId=options.products[draft.name] ?? matchingProduct(draft.name,state.products);
    if(productId==='__skip') {omitted++;return;}
    try {
      if(draft.issues?.length) throw new Error(draft.issues[0]);
      if(!productId) throw new Error(`Asocia «${draft.name || 'sin nombre'}» a un postre del catálogo o elige omitirlo.`);
      const fallback=(value:ExcelCell,alternative:string)=>value===null||String(value).trim()===''?alternative:value;
      const base={productId,date:excelDate(fallback(draft.date,options.date),options.date1904),period:excelPeriod(fallback(draft.period,options.period)),sheet:draft.sheet,row:draft.row};
      const v=draft.values;
      if(kind==='turno') {
        const opening=number(v.opening,'Entrada'),incoming=number(v.incoming,'Ingreso nuevo'),closing=number(v.closing,'Salida de turno');
        const sold=opening+incoming-closing;
        if(sold<0) throw new Error('La salida de turno supera la entrada más los ingresos.');
        if(v.sold!==null && v.sold!==undefined && String(v.sold).trim()!=='' && number(v.sold,'Ventas')!==sold) throw new Error('Las ventas del Excel no coinciden con entrada + ingreso − salida.');
        records.push({...base,kind,opening,incoming,closing});
      } else {
        const opening=number(v.opening,'Entrada'),produced=number(v.produced,'Producción'),used=number(v.used,'Moldes usados');
        const quantity=opening+produced-used;
        if(quantity<0) throw new Error('Los moldes usados superan los disponibles.');
        if(v.quantity!==null && v.quantity!==undefined && String(v.quantity).trim()!=='' && number(v.quantity,'Saldo')!==quantity) throw new Error('El saldo no coincide con entrada + producción − usados.');
        records.push({...base,kind,opening,produced,used,quantity});
      }
    } catch(error) {errors.push(`Fila ${draft.row} (${draft.name || 'sin producto'}): ${(error as Error).message}`);}
  });
  if(records.length) {
    try {validateExcelRecords(records,state.products);}catch(error){errors.push((error as Error).message);}
    errors.push(...excelConflicts(state,records));
  }
  return {records,errors,omitted};
}
