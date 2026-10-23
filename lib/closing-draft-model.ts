export type DraftField = {productId:string;value:number|null;version:number};
export type DraftSnapshot = {shiftId:string;fields:DraftField[]};
export type PendingDraft = {value:string;version:number};
export type DraftConflict = {productId:string;localValue:string;remoteValue:string};

export const draftText = (value:number|null) => value===null?'':String(value);
export function draftNumber(value:string):number|null|undefined {
  if(value==='')return null;
  if(!/^\d{1,6}$/.test(value))return undefined;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>=0&&number<=100000?number:undefined;
}
export const sameDraftValue=(text:string,value:number|null)=>draftNumber(text)!==undefined&&draftNumber(text)===value;

// A recovered browser edit may only be replayed against the version it saw.
export function reconcileDraft(snapshot:DraftSnapshot,pending:Record<string,PendingDraft>) {
  const counts:Record<string,string>={},versions:Record<string,number>={},remaining:Record<string,PendingDraft>={};
  const conflicts:DraftConflict[]=[];
  for(const field of snapshot.fields){
    const remote=draftText(field.value),local=pending[field.productId];
    versions[field.productId]=field.version;
    counts[field.productId]=remote;
    if(!local || sameDraftValue(local.value,field.value))continue;
    counts[field.productId]=local.value;
    remaining[field.productId]={...local};
    if(local.version!==field.version)conflicts.push({productId:field.productId,localValue:local.value,remoteValue:remote});
  }
  // A first GET may fail or be older than a newly added product. Keep its recovery edit.
  for(const [productId,local] of Object.entries(pending))if(!Object.hasOwn(versions,productId)){
    counts[productId]=local.value;versions[productId]=local.version;remaining[productId]={...local};
  }
  return {counts,versions,pending:remaining,conflicts};
}

export function latestDraftSnapshot(previous:DraftSnapshot,incoming:DraftSnapshot):DraftSnapshot {
  if(previous.shiftId!==incoming.shiftId)return incoming;
  const fields=new Map(previous.fields.map(field=>[field.productId,field]));
  for(const field of incoming.fields)if(!fields.has(field.productId)||fields.get(field.productId)!.version<=field.version)fields.set(field.productId,field);
  return {shiftId:incoming.shiftId,fields:[...fields.values()]};
}

export function acknowledgeDraft(snapshot:DraftSnapshot,sent:Record<string,PendingDraft>,pending:Record<string,PendingDraft>) {
  const result={...pending};
  for(const field of snapshot.fields){
    const previous=sent[field.productId],current=pending[field.productId];
    if(previous&&current&&previous.version===current.version)result[field.productId]={...current,version:field.version};
  }
  return result;
}

export function recoverDraftBackups(own:Record<string,PendingDraft>,backups:Record<string,Record<string,PendingDraft>>) {
  const pending={...own},conflicts=new Set<string>();
  for(const backup of Object.values(backups))for(const [id,field] of Object.entries(backup)){
    const current=pending[id];
    if(!current)pending[id]={...field};
    else if(current.value!==field.value&&!(draftNumber(current.value)!==undefined&&draftNumber(current.value)===draftNumber(field.value)))conflicts.add(id);
  }
  return {pending,conflicts};
}

export function readDraftBackup(raw:string|null):Record<string,PendingDraft> {
  if(!raw)return {};
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
    const result:Record<string,PendingDraft>={};
    for(const [key,value] of Object.entries(parsed).slice(0,1000)){
      if(!key || key.length>100 || ['__proto__','constructor','prototype'].includes(key) || !value||typeof value!=='object')continue;
      const item=value as Partial<PendingDraft>;
      if(typeof item.value==='string'&&item.value.length<=20&&typeof item.version==='number'&&Number.isSafeInteger(item.version)&&item.version>=0)result[key]={value:item.value,version:item.version};
    }
    return result;
  }catch{return {};}
}
