import { access } from 'node:fs/promises';
import path from 'node:path';
export class InventoryMaintenanceError extends Error {
  constructor(){super('Inventario en mantenimiento. Los registros están pausados temporalmente; espera unos momentos y actualiza la página.');}
}
export async function assertInventoryWritable(){
  try{await access(path.join(process.cwd(),'data','migration-maintenance.json'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  throw new InventoryMaintenanceError();
}
