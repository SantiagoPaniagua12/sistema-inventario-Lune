import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lowStockPdf } from '../lib/low-stock-pdf';
import { initialSupplies } from '../lib/supplies';
async function main() {
  const seed=initialSupplies();
  const items=Array.from({length:80},(_,i)=>({...seed[i%seed.length],id:`qa-${i}`,name:`${seed[i%seed.length].name} · prueba ${i+1}${i%4===0?' con descripción extensa para verificar los saltos de línea del reporte':''}`,stock:i%3,minimum:5,estimated:i%seed.length===32}));
  await mkdir(path.join(process.cwd(),'tmp','pdfs'),{recursive:true});
  await writeFile(path.join(process.cwd(),'tmp','pdfs','qa-insumos.pdf'),await lowStockPdf(items,{at:new Date('2026-10-21T18:00:00Z')}));
  console.log('PDF de control generado con 80 filas ficticias en tmp/pdfs/qa-insumos.pdf. No usa datos reales.');
}
main().catch(()=>{console.error('No se pudo generar el PDF de control.');process.exitCode=1;});
