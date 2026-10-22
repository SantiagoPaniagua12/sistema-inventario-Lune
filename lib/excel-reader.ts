import ExcelJS from 'exceljs';
import { fromBuffer } from 'yauzl';
import type { ExcelSheet } from './excel-preview';

async function checkZip(bytes: Buffer) {
  await new Promise<void>((resolve,reject)=>{
    fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if (error || !zip) { reject(new Error('El archivo no es un Excel .xlsx válido.')); return; }
      let size=0, actual=0, entries=0, failed=false;
      const fail=()=>{ if(failed)return; failed=true; zip.close(); reject(new Error('El Excel supera los límites de lectura o contiene un archivo comprimido inválido. Usa un archivo sin imágenes grandes.')); };
      zip.on('error',fail);
      zip.on('end',()=>{if(!failed)resolve();});
      zip.on('entry',entry=>{
        size+=entry.uncompressedSize; entries++;
        if(size>32_000_000 || entry.uncompressedSize>16_000_000 || entries>500 || (entry.generalPurposeBitFlag & 1)) {fail();return;}
        zip.openReadStream(entry,(readError,stream)=>{
          if(readError || !stream){fail();return;}
          stream.on('data',(chunk:Buffer)=>{actual+=chunk.length;if(actual>32_000_000){stream.destroy();fail();}});
          stream.on('error',fail);
          stream.on('end',()=>{if(!failed)zip.readEntry();});
        });
      });
      zip.readEntry();
    });
  });
}
export async function readExcel(bytes: Buffer): Promise<ExcelSheet[]> {
  if(!bytes.length || bytes.length>5_000_000) throw new Error('El Excel debe ocupar como máximo 5 MB.');
  await checkZip(bytes);
  const workbook=new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new Error('No se pudo leer el .xlsx. Ábrelo y vuelve a guardarlo desde Excel.'); }
  const sheets=workbook.worksheets.filter(sheet=>sheet.state==='visible');
  if(!sheets.length || sheets.length>24) throw new Error('El archivo debe tener entre 1 y 24 hojas visibles.');
  let cells=0,chars=0;
  function cellValue(value: ExcelJS.CellValue): string | number | null {
    if(value===null || value===undefined) return null;
    if(value instanceof Date) return value.toISOString().slice(0,10);
    if(typeof value==='number') return Number.isFinite(value) ? value : '#NUM';
    if(typeof value==='string') return value;
    if(typeof value==='boolean') return String(value);
    if('formula' in value || 'sharedFormula' in value) return value.result === undefined ? '#FORMULA_SIN_RESULTADO' : cellValue(value.result);
    if('error' in value) return value.error;
    if('richText' in value) return value.richText.map(part=>part.text).join('');
    if('text' in value) return value.text;
    return '#VALOR_NO_COMPATIBLE';
  }
  return sheets.map(sheet=>{
    if(sheet.rowCount>5000 || sheet.columnCount>100) throw new Error(`La hoja ${sheet.name} supera 5000 filas o 100 columnas. Divide el archivo.`);
    const rows=Array.from({length:sheet.rowCount},(_,r)=>Array.from({length:sheet.columnCount},(_,c)=>{
      cells++;
      const value=cellValue(sheet.getCell(r+1,c+1).value);
      const length=typeof value==='string' ? value.length : 0;
      chars+=length;
      if(cells>200000 || chars>2_000_000 || length>1000) throw new Error('El Excel contiene demasiadas celdas o texto. Divide el archivo.');
      return value;
    }));
    return {name:sheet.name,rows,date1904:!!workbook.properties.date1904};
  });
}
