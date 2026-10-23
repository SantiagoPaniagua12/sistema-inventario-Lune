import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {acknowledgeDraft,draftNumber,latestDraftSnapshot,readDraftBackup,reconcileDraft,recoverDraftBackups,type DraftSnapshot} from '../lib/closing-draft-model';
import {assertClosingDrafts,validateDraftRequest} from '../lib/closing-drafts';
import {AccessError} from '../lib/access';

test('borrador distingue vacío y cero; rechaza fracciones, signos y valores fuera de límite',()=>{
  assert.equal(draftNumber(''),null);assert.equal(draftNumber('0'),0);assert.equal(draftNumber('100000'),100000);
  for(const value of ['-1','1.5','NaN','100001','Infinity','1e2',' '])assert.equal(draftNumber(value),undefined);
});

test('el cuerpo de borrador exige versiones, productos únicos y cantidades válidas',()=>{
  assert.deepEqual(validateDraftRequest({shiftId:'3',fields:[{productId:'17',value:0,version:0},{productId:'18',value:null,version:2}]}),{shiftId:'3',fields:[{productId:'17',value:0,version:0},{productId:'18',value:null,version:2}]});
  for(const body of [
    {shiftId:'',fields:[]}, {shiftId:'abc',fields:[{productId:'17',value:0,version:0}]},
    {shiftId:'3',fields:[{productId:'17',value:-1,version:0}]},
    {shiftId:'3',fields:[{productId:'17',value:0}]},
    {shiftId:'3',fields:[{productId:'17',value:'0',version:0}]},
    {shiftId:'3',fields:[{productId:'17',value:0,version:1},{productId:'17',value:2,version:1}]},
  ])assert.throws(()=>validateDraftRequest(body),AccessError);
});

test('recuperar conteos de otra sesión conserva cambios pendientes y denuncia conflictos',()=>{
  const snapshot:DraftSnapshot={shiftId:'3',fields:[{productId:'17',value:3,version:2},{productId:'18',value:null,version:0}]};
  const recovered=reconcileDraft(snapshot,{'17':{value:'4',version:1},'18':{value:'0',version:0}});
  assert.deepEqual(recovered.counts,{'17':'4','18':'0'});
  assert.deepEqual(recovered.versions,{'17':2,'18':0});
  assert.deepEqual(recovered.conflicts,[{productId:'17',localValue:'4',remoteValue:'3'}]);
  assert.deepEqual(recovered.pending,{'17':{value:'4',version:1},'18':{value:'0',version:0}});
  const resolved=reconcileDraft(snapshot,{'17':{value:'4',version:2}});
  assert.equal(resolved.conflicts.length,0);
  assert.equal(resolved.counts['17'],'4');
});

test('respuesta perdida de un guardado no duplica cambios ni produce falso conflicto',()=>{
  const result=reconcileDraft({shiftId:'3',fields:[{productId:'17',value:4,version:8}]},{'17':{value:'4',version:7}});
  assert.deepEqual(result.pending,{});assert.equal(result.conflicts.length,0);assert.equal(result.versions['17'],8);
  const leadingZeros=reconcileDraft({shiftId:'3',fields:[{productId:'17',value:4,version:8}]},{'17':{value:'004',version:7}});
  assert.deepEqual(leadingZeros.pending,{});assert.equal(leadingZeros.counts['17'],'4');assert.equal(leadingZeros.conflicts.length,0);
});

test('un GET iniciado antes del guardado no restaura versiones antiguas ni borra teclas aún pendientes',()=>{
  const previous:DraftSnapshot={shiftId:'3',fields:[{productId:'17',value:4,version:8},{productId:'18',value:0,version:1}]};
  const old:DraftSnapshot={shiftId:'3',fields:[{productId:'17',value:3,version:7}]};
  const latest=latestDraftSnapshot(previous,old);
  assert.deepEqual(latest,previous);
  const merged=reconcileDraft(latest,{'19':{value:'6',version:0},'17':{value:'5',version:8}});
  assert.equal(merged.counts['17'],'5');assert.equal(merged.counts['19'],'6');assert.deepEqual(merged.pending['19'],{value:'6',version:0});
});

test('teclear mientras un PUT está en curso conserva el nuevo valor y guarda contra la versión confirmada',()=>{
  const sent={'17':{value:'4',version:7}};
  const latest={'17':{value:'5',version:7},'18':{value:'0',version:0}};
  const response:DraftSnapshot={shiftId:'3',fields:[{productId:'17',value:4,version:8},{productId:'18',value:null,version:0}]};
  const pending=acknowledgeDraft(response,sent,latest);
  const merged=reconcileDraft(response,pending);
  assert.equal(merged.counts['17'],'5');assert.equal(merged.counts['18'],'0');assert.equal(merged.pending['17'].version,8);assert.equal(merged.conflicts.length,0);
  const afterOtherTab:DraftSnapshot={shiftId:'3',fields:[{productId:'17',value:6,version:9},{productId:'18',value:null,version:0}]};
  const conflict=reconcileDraft(latestDraftSnapshot(afterOtherTab,response),pending);
  assert.deepEqual(conflict.conflicts,[{productId:'17',localValue:'5',remoteValue:'6'}]);
});

test('recuperar varias pestañas combina productos distintos y obliga elegir cuando el mismo producto difiere',()=>{
  const backupA={'17':{value:'4',version:1}},backupB={'18':{value:'0',version:0}};
  const safe=recoverDraftBackups(backupA,{a:backupA,b:backupB});
  assert.deepEqual(safe.pending,{'17':{value:'4',version:1},'18':{value:'0',version:0}});assert.equal(safe.conflicts.size,0);
  const conflicting=recoverDraftBackups(backupA,{a:backupA,b:{'17':{value:'6',version:1}}});
  assert.equal(conflicting.pending['17'].value,'4');assert.deepEqual([...conflicting.conflicts],['17']);
  const equal=recoverDraftBackups(backupA,{a:{'17':{value:'004',version:0}}});
  assert.equal(equal.conflicts.size,0);assert.equal(backupA['17'].value,'4');
});

test('la copia del navegador rechaza JSON inválido y objetos que alteren prototipos',()=>{
  assert.deepEqual(readDraftBackup('bad'),{});assert.deepEqual(readDraftBackup('[]'),{});
  assert.deepEqual(readDraftBackup('{"17":{"value":"4","version":2},"18":{"value":3,"version":0},"__proto__":{"value":"1","version":0}}'),{'17':{value:'4',version:2}});
});

test('el cierre definitivo rechaza conteos de otra versión o distintos al borrador guardado',async()=>{
  const client={query:async()=>({rowCount:2,rows:[{id_producto:17,cantidad:3,version:2},{id_producto:18,cantidad:0,version:1}]})} as unknown as PoolClient;
  await assertClosingDrafts(client,'3',{'17':3,'18':0},{'17':2,'18':1});
  for(const [counts,versions] of [[{'17':3,'18':0},undefined],[{'17':3,'18':0},{'17':1,'18':1}],[{'17':4,'18':0},{'17':2,'18':1}],[{'17':3},{'17':2,'18':1}]] as const){
    await assert.rejects(()=>assertClosingDrafts(client,'3',counts,versions),(error:unknown)=>error instanceof AccessError&&error.status===409);
  }
});
