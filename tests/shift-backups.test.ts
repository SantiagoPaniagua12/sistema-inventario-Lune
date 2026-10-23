import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {INVENTORY_TABLES,type InventorySnapshot} from '../lib/migration';
import {seed,type Shift} from '../lib/inventory';
import {backupHash,backupPath,makeShiftBackup,encodeShiftBackup,decodeShiftBackup} from '../lib/shift-backup-format';
import {uploadAndVerifyBackup,BackupStorageError,type BackupStorage,type BackupJob} from '../lib/shift-backups';
function fixture(){
  const inventory=seed();inventory.revision=12;
  const shift:Shift={id:'3',date:'2026-10-23',period:'Mañana',responsible:'Shalu',responsibles:['Shalu'],status:'closed',closedAt:'2026-10-23T18:00:00.000Z',rows:[]};inventory.shifts=[shift];
  const tables=Object.fromEntries(INVENTORY_TABLES.map(t=>[t,[]])) as unknown as InventorySnapshot;
  tables.usuarios=[{id_usuario:1,nombre_usuario:'Shalu',password_hash:'hash-que-no-debe-salir',email:'privado@example.test',rol:'mostrador',activo:true}];
  const payload=makeShiftBackup(inventory,tables,shift,'cierre','2026-10-23T18:00:01.000Z');
  const job:BackupJob={id:crypto.randomUUID(),contenido:payload,sha256:backupHash(payload),archivo:backupPath(shift,12),bloqueo:crypto.randomUUID(),intentos:1};
  return {inventory,tables,shift,payload,job};
}
test('copia de cierre elimina credenciales de registro sin alterar el original',()=>{
  const {payload,tables}=fixture();
  assert.equal(payload.tables.usuarios[0].password_hash,'!');assert.equal(payload.tables.usuarios[0].email,null);
  assert.equal(tables.usuarios[0].password_hash,'hash-que-no-debe-salir');
  assert(!JSON.stringify(payload).includes('hash-que-no-debe-salir'));
});
test('no se puede crear un respaldo de un turno abierto',()=>{
  const {inventory,tables,shift}=fixture();
  assert.throws(()=>makeShiftBackup(inventory,tables,{...shift,status:'open'},'cierre'));
});
test('cada fecha, turno y revisión tiene un archivo distinto',()=>{
  const {shift}=fixture();
  assert.equal(backupPath(shift,12),'2026/10/2026-10-23_manana_turno-3_rev-12.json.gz');
  assert.notEqual(backupPath(shift,12),backupPath(shift,13));
  assert.notEqual(backupPath(shift,12),backupPath({...shift,period:'Tarde'},12));
  assert.throws(()=>backupPath({...shift,id:'../secreto'},12));
});
test('JSON canónico mantiene la integridad después de almacenamiento JSONB',()=>{
  const {payload,job}=fixture();
  const reordered={tables:payload.tables,inventory:payload.inventory,trigger:payload.trigger,capturedAt:payload.capturedAt,format:payload.format};
  assert.equal(backupHash(reordered),job.sha256);
  assert.deepEqual(decodeShiftBackup(encodeShiftBackup(reordered,job.sha256),job.sha256),payload);
  assert.throws(()=>decodeShiftBackup(gzipSync(Buffer.from(JSON.stringify({...payload,capturedAt:'otra fecha'}))),job.sha256),/CHECKSUM/);
  assert.throws(()=>encodeShiftBackup({...payload,capturedAt:'otra fecha'},job.sha256),/CHECKSUM/);
});
test('subir no basta: el archivo descargado tiene que pasar SHA-256',async()=>{
  const {job}=fixture();let written:Uint8Array|undefined;
  const storage:BackupStorage={async ensurePrivate(){},async put(_path,data){written=data;},async get(){return written!;}};
  assert((await uploadAndVerifyBackup(job,storage))>0);
  storage.get=async()=>gzipSync(Buffer.from('{}'));
  await assert.rejects(()=>uploadAndVerifyBackup(job,storage),/CHECKSUM/);
});
test('se rechaza un bucket público antes de enviar datos',async()=>{
  const {job}=fixture();let wrote=false;
  const storage:BackupStorage={async ensurePrivate(){throw new BackupStorageError('BACKUP_BUCKET_PUBLIC');},async put(){wrote=true;},async get(){return new Uint8Array();}};
  await assert.rejects(()=>uploadAndVerifyBackup(job,storage),/PUBLIC/);assert.equal(wrote,false);
});
