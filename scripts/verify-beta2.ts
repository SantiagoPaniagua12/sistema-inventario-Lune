import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import { GET as inventoryGet } from '../app/api/inventory/route';
import { GET as reportGet } from '../app/api/reports/low-stock/route';
import { getPgPool } from '../lib/postgres';
loadEnvConfig(process.cwd());
async function main() {
  // Invoca los handlers directamente: no levanta HTTP ni abre un puerto.
  const response=await inventoryGet();
  assert.equal(response.status,200);
  const data=await response.json();
  assert(Array.isArray(data.supplies));
  const pdf=await reportGet(new Request('http://127.0.0.1:3000/api/reports/low-stock?groups=Insumos%7CBebidas'));
  assert.equal(pdf.status,200);
  assert.equal(pdf.headers.get('Content-Type'),'application/pdf');
  const bytes=new Uint8Array(await pdf.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
  console.log(JSON.stringify({storage:response.headers.get('X-Inventory-Storage'),productos:data.products.length,insumos:data.supplies.length,sinConteo:data.supplies.filter((i:{stock:number|null})=>i.stock===null).length,pdf:'OK',servidorIniciado:false}));
}
main().catch(()=>{console.error('Falló la verificación de la beta. Revisa la base y ejecuta npm run db:beta2.');process.exitCode=1;}).finally(async()=>{try{await getPgPool().end();}catch{}});
