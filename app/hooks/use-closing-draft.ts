'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {acknowledgeDraft,draftNumber,latestDraftSnapshot,readDraftBackup,reconcileDraft,recoverDraftBackups,sameDraftValue,type DraftConflict,type DraftSnapshot,type PendingDraft} from '@/lib/closing-draft-model';

type Status='loading'|'saved'|'saving'|'pending'|'conflict'|'error';
type Context={shiftId:string;key:string;prefix:string;alive:boolean;ready:Promise<void>;resolveReady:()=>void;recovered:Record<string,Record<string,PendingDraft>>;recoveryConflicts:Set<string>};
let documentRecoveryId:string|undefined;
export function useClosingDraft(shiftId:string|undefined,enabled:boolean,scope='salon') {
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [versions,setVersions]=useState<Record<string,number>>({});
  const [status,setStatus]=useState<Status>('loading');
  const [error,setError]=useState('');
  const [conflicts,setConflicts]=useState<DraftConflict[]>([]);
  const context=useRef<Context|null>(null);
  const countsRef=useRef<Record<string,string>>({}),versionsRef=useRef<Record<string,number>>({});
  const remoteRef=useRef<DraftSnapshot>({shiftId:'',fields:[]});
  const pendingRef=useRef<Record<string,PendingDraft>>({});
  const conflictsRef=useRef<DraftConflict[]>([]);
  const saving=useRef<Promise<boolean>|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const loadRef=useRef<()=>Promise<boolean>>(async()=>false);
  const flushRef=useRef<()=>Promise<boolean>>(async()=>false);

  const pruneRecovery=useCallback((productId:string,explicit=false)=>{
    const current=context.current;if(!current?.alive)return;
    const remote=remoteRef.current.fields.find(field=>field.productId===productId);
    if(!remote)return;
    for(const [key,recovered] of Object.entries(current.recovered)){
      if(key===current.key||!recovered[productId])continue;
      try{
        const latest=readDraftBackup(localStorage.getItem(key)),field=latest[productId],old=recovered[productId];
        // Never delete a newer edit belonging to another open tab.
        if(field && field.value===old.value && field.version===old.version && (explicit||sameDraftValue(field.value,remote.value))){
          delete latest[productId];delete recovered[productId];
          if(Object.keys(latest).length)localStorage.setItem(key,JSON.stringify(latest));else localStorage.removeItem(key);
        }
      }catch{/* Recovery files remain available when storage is temporarily inaccessible. */}
    }
  },[]);

  const persist=useCallback(()=>{
    const current=context.current;if(!current?.alive)return;
    try{
      if(Object.keys(pendingRef.current).length)localStorage.setItem(current.key,JSON.stringify(pendingRef.current));
      else localStorage.removeItem(current.key);
    }catch{
      setError('El navegador no permite la copia de recuperación. Mantén la página abierta hasta ver «Guardado».');
    }
  },[]);
  const apply=useCallback((snapshot:DraftSnapshot)=>{
    const current=context.current;if(!current?.alive||snapshot.shiftId!==current.shiftId)return;
    snapshot=latestDraftSnapshot(remoteRef.current,snapshot);remoteRef.current=snapshot;
    const merged=reconcileDraft(snapshot,pendingRef.current);
    for(const productId of current.recoveryConflicts){
      const field=snapshot.fields.find(field=>field.productId===productId),local=pendingRef.current[productId];
      if(field&&local&&!merged.conflicts.some(item=>item.productId===productId))merged.conflicts.push({productId,localValue:local.value,remoteValue:field.value===null?'':String(field.value)});
    }
    countsRef.current=merged.counts;versionsRef.current=merged.versions;pendingRef.current=merged.pending;conflictsRef.current=merged.conflicts;
    setCounts({...merged.counts});setVersions({...merged.versions});setConflicts([...merged.conflicts]);
    setStatus(merged.conflicts.length?'conflict':Object.keys(merged.pending).length?'pending':'saved');
    for(const field of snapshot.fields)pruneRecovery(field.productId);
    persist();
  },[persist,pruneRecovery]);

  const flush=useCallback(async():Promise<boolean>=>{
    const current=context.current;
    if(!current?.alive)return true;
    await current.ready;
    if(!current.alive)return false;
    if(timer.current){clearTimeout(timer.current);timer.current=null;}
    if(saving.current){await saving.current;if(!current.alive)return false;}
    const work=async()=>{
      for(let attempts=0;attempts<8;attempts++){
        if(!current.alive)return false;
        if(conflictsRef.current.length){setStatus('conflict');return false;}
        const pending={...pendingRef.current};
        if(!Object.keys(pending).length){setStatus('saved');return true;}
        const fields=[];
        for(const [productId,field] of Object.entries(pending)){
          const value=draftNumber(field.value);
          if(value===undefined){setError('Revisa el conteo: usa un entero entre 0 y 100000. Lo escrito se conserva en este navegador.');setStatus('error');return false;}
          fields.push({productId,value,version:field.version});
        }
        setStatus('saving');setError('');persist();
        try{
          const response=await fetch('/api/inventory/draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shiftId:current.shiftId,fields})});
          const result=await response.json();
          if(!current.alive)return false;
          if(response.status===409&&Array.isArray(result.fields)){
            apply(result);setError(result.error||'Hay conteos en conflicto. Revisa cuál conservar.');return false;
          }
          if(!response.ok)throw new Error(result.error||'No se pudo guardar el borrador.');
          if(result.shiftId!==current.shiftId||!Array.isArray(result.fields))throw new Error('El servidor devolvió un borrador inesperado.');
          // Keystrokes made during this request keep their value, but advance their base version.
          pendingRef.current=acknowledgeDraft(result,pending,pendingRef.current);
          apply(result);
        }catch(failure){
          if(!current.alive)return false;
          persist();setStatus('error');setError((failure as Error).message||'No se pudo guardar. Tus cambios pendientes siguen en este navegador.');return false;
        }
      }
      setStatus('pending');return false;
    };
    const task=work();saving.current=task;
    try{return await task;}finally{if(saving.current===task)saving.current=null;}
  },[enabled,apply,persist]);
  flushRef.current=flush;

  const setCount=useCallback((productId:string,value:string)=>{
    if(!context.current?.alive)return;
    const previous=pendingRef.current[productId];
    pendingRef.current={...pendingRef.current,[productId]:{value,version:previous?.version??versionsRef.current[productId]??0}};
    countsRef.current={...countsRef.current,[productId]:value};setCounts({...countsRef.current});
    const conflict=conflictsRef.current.find(item=>item.productId===productId);
    if(conflict){conflictsRef.current=conflictsRef.current.map(item=>item.productId===productId?{...item,localValue:value}:item);setConflicts([...conflictsRef.current]);}
    setStatus(conflictsRef.current.length?'conflict':'pending');setError('');persist();
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>void flushRef.current(),550);
  },[persist]);

  const resolveConflict=useCallback((productId:string,choice:'local'|'remote')=>{
    if(!context.current?.alive)return;
    const field=remoteRef.current.fields.find(field=>field.productId===productId);if(!field)return;
    context.current.recoveryConflicts.delete(productId);pruneRecovery(productId,true);
    if(choice==='remote')delete pendingRef.current[productId];
    else{
      const value=pendingRef.current[productId]?.value??countsRef.current[productId]??'';
      pendingRef.current[productId]={value,version:field.version};
    }
    apply(remoteRef.current);setError('');
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>void flushRef.current(),100);
  },[apply,pruneRecovery]);

  useEffect(()=>{
    if(!enabled||!shiftId){
      context.current=null;countsRef.current={};versionsRef.current={};pendingRef.current={};conflictsRef.current=[];
      setCounts({});setVersions({});setConflicts([]);setError('');setStatus('saved');return;
    }
    let resolveReady=()=>{};
    if(!documentRecoveryId)documentRecoveryId=crypto.randomUUID();
    const recoveryId=documentRecoveryId;
    const prefix=`lune:closing-draft:v1:${scope}:${shiftId}`;
    const current:Context={shiftId,key:`${prefix}:${recoveryId}`,prefix,alive:true,ready:new Promise<void>(resolve=>{resolveReady=resolve;}),resolveReady:()=>resolveReady(),recovered:{},recoveryConflicts:new Set()};
    context.current=current;remoteRef.current={shiftId,fields:[]};countsRef.current={};versionsRef.current={};pendingRef.current={};conflictsRef.current=[];saving.current=null;
    setCounts({});setVersions({});setConflicts([]);setError('');setStatus('loading');
    try{
      pendingRef.current=readDraftBackup(localStorage.getItem(current.key));
      const keys=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter((key):key is string=>!!key&&(key===prefix||key.startsWith(`${prefix}:`)));
      for(const key of keys){
        const recovered=readDraftBackup(localStorage.getItem(key));current.recovered[key]=recovered;
      }
      const recovered=recoverDraftBackups(pendingRef.current,current.recovered);
      pendingRef.current=recovered.pending;current.recoveryConflicts=recovered.conflicts;
    }catch{/* Remote save remains available when storage is disabled. */}
    if(Object.keys(pendingRef.current).length){countsRef.current=Object.fromEntries(Object.entries(pendingRef.current).map(([id,item])=>[id,item.value]));setCounts({...countsRef.current});}
    const load=async()=>{
      if(!current.alive||saving.current)return false;
      try{
        const response=await fetch(`/api/inventory/draft?shiftId=${encodeURIComponent(shiftId)}`,{cache:'no-store'});
        const result=await response.json();
        if(!current.alive)return false;
        if(!response.ok)throw new Error(result.error||'No se pudo recuperar el borrador.');
        if(result.shiftId!==shiftId||!Array.isArray(result.fields))throw new Error('No se pudo recuperar el borrador.');
        apply(result);return true;
      }catch(failure){if(current.alive){setStatus('error');setError((failure as Error).message);}return false;}
    };
    loadRef.current=load;
    void load().then(()=>{current.resolveReady();if(current.alive&&Object.keys(pendingRef.current).length&&!conflictsRef.current.length)void flushRef.current();});
    const visible=()=>{if(document.visibilityState==='visible')void load().then(()=>{if(Object.keys(pendingRef.current).length&&!conflictsRef.current.length)void flushRef.current();});};
    const storage=(event:StorageEvent)=>{if(event.key===prefix||event.key?.startsWith(`${prefix}:`))visible();};
    const leave=()=>persist();
    window.addEventListener('focus',visible);window.addEventListener('online',visible);window.addEventListener('storage',storage);window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visible);
    const refresh=setInterval(visible,12000);
    return()=>{
      persist();current.alive=false;current.resolveReady();if(context.current===current)context.current=null;
      if(timer.current){clearTimeout(timer.current);timer.current=null;}
      clearInterval(refresh);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);window.removeEventListener('storage',storage);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visible);
    };
  },[shiftId,enabled,scope,apply,persist]);

  const getSnapshot=useCallback(()=>({counts:{...countsRef.current},versions:{...versionsRef.current}}),[]);
  const refresh=useCallback(()=>loadRef.current(),[]);
  return {counts,versions,setCount,status,error,flush,getSnapshot,conflicts,resolveConflict,refresh};
}
