import type { PoolClient } from 'pg';
import type { ExcelImport } from './excel-history';
export async function readExcelImports(client: PoolClient): Promise<ExcelImport[]> {
  const ready = await client.query(`SELECT to_regclass('importaciones_excel') IS NOT NULL AS ready`);
  if (!ready.rows[0].ready) return [];
  const result = await client.query('SELECT * FROM importaciones_excel ORDER BY creado_en,id_importacion');
  return result.rows.map(row=>({ id:row.id_importacion, filename:row.archivo, importedBy:row.importado_por, importedAt:new Date(row.creado_en).toISOString(), records:row.registros }));
}
export async function persistExcelImport(client: PoolClient, batch: ExcelImport) {
  await client.query('INSERT INTO importaciones_excel(id_importacion,archivo,importado_por,creado_en,registros) VALUES($1,$2,$3,$4,$5::jsonb)',[batch.id,batch.filename,batch.importedBy,batch.importedAt,JSON.stringify(batch.records)]);
}
