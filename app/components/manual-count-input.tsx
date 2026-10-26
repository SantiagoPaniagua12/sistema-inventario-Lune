'use client';
import {useEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {manualNumberMessage,normalizeManualNumber} from '@/lib/manual-number';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'inputMode'|'value'|'defaultValue'> & {value?:string;defaultValue?:string|number;decimalPlaces?:number};
/** Text inputs avoid native number stepping while retaining form validation. */
export function ManualCountInput({value,defaultValue,onChange,onKeyDown,min,max,step,maxLength,decimalPlaces=0,...props}:Props){
 const [local,setLocal]=useState(String(defaultValue??''));
 const field=useRef<HTMLInputElement>(null),current=value??local;
 const message=manualNumberMessage(current,{min,max,step,decimalPlaces});
 const length=maxLength??20;
 useEffect(()=>{field.current?.setCustomValidity(message);},[message,current]);
 return <input {...props} ref={field} type="text" inputMode={decimalPlaces?'decimal':'numeric'} pattern={decimalPlaces?`[0-9]+([.][0-9]{1,${decimalPlaces}})?`:'[0-9]*'} min={min} max={max} step={step} maxLength={length} value={current} aria-invalid={message?true:props['aria-invalid']} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown')event.preventDefault();onKeyDown?.(event);}} onChange={event=>{
  const next=normalizeManualNumber(event.target.value,decimalPlaces);if(next===null)return;
  event.currentTarget.value=next;event.currentTarget.setCustomValidity(manualNumberMessage(next,{min,max,step,decimalPlaces}));
  if(value===undefined)setLocal(next);onChange?.(event);
 }}/>;
}
