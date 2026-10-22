import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { matrixDrafts, previewExcel, type ExcelSheet } from '../lib/excel-preview';
import type { State } from '../lib/inventory';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

async function main(){
  const url='http://127.0.0.1:3000';
  const direct=process.argv.includes('--direct');
  async function call(route:string,init?:RequestInit){
    if(!direct)return fetch(`${url}${route}`,init);
    if(route==='/api/inventory')return (await import('../app/api/inventory/route')).GET();
    const request=new Request(`${url}${route}`,init);
    return (await import('../app/api/imports/excel/preview/route')).POST(request);
  }
  const response=await call('/api/inventory');
  assert.equal(response.status,200);
  const before=await response.json() as State;
  const product=before.products.find(product=>product.category==='Postres')!;
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('POSTRES MAÑANA');
  sheet.getCell('A1').value='POSTRES TURNO MAÑANA';sheet.mergeCells('B1:C1');sheet.getCell('B1').value='15/10/2025';
  sheet.mergeCells('A2:A5');sheet.getCell('A2').value=product.name;
  ['Entrada','Ingreso nuevo','Salida turno','Ventas'].forEach((label,index)=>{sheet.getCell(index+2,2).value=label;sheet.getCell(index+2,3).value=[6,4,3,7][index];});
  await mkdir(path.join(process.cwd(),'tmp','qa'),{recursive:true});
  const filename=path.join(process.cwd(),'tmp','qa','validacion-importacion.xlsx');
  await book.xlsx.writeFile(filename);
  const bytes=await book.xlsx.writeBuffer();
  const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)]),'qa-no-se-guarda.xlsx');
  const preview=await call('/api/imports/excel/preview',{method:'POST',headers:{Origin:url,Host:'127.0.0.1:3000'},body:form});
  assert.equal(preview.status,200);
  const result=await preview.json() as {sheets:ExcelSheet[]};
  const parsed=previewExcel(matrixDrafts(result.sheets[0],'turno'),before,'turno',{products:{},date:'',period:'',date1904:false});
  // A real historical record may already occupy this date; parsing still must succeed.
  assert.equal(parsed.records.length,1);
  const refused=await call('/api/imports/excel/preview',{method:'POST',headers:{Origin:'https://otro-dominio.example',Host:'127.0.0.1:3000'},body:new FormData()});
  assert.equal(refused.status,403);
  const invalid=new FormData();invalid.set('file',new Blob(['no es Excel']),'archivo.xlsx');
  assert.equal((await call('/api/imports/excel/preview',{method:'POST',headers:{Origin:url,Host:'127.0.0.1:3000'},body:invalid})).status,400);
  const after=await (await call('/api/inventory')).json();
  assert.deepEqual(after,before,'La vista previa no debe guardar datos');
  console.log(`OK: carga .xlsx ${direct?'mediante controladores directos, sin servidor':'por HTTP'}, reconocimiento del bloque, rechazo de origen y archivo inválidos; inventario sin cambios.`);
  console.log('Fixture de revisión visual en tmp/qa/validacion-importacion.xlsx; no importarlo al historial real.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Falló la verificación de carga.');process.exitCode=1;}).finally(async()=>{if(process.argv.includes('--direct'))await(await import('../lib/postgres')).getPgPool().end();});
