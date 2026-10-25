'use client';
import {useState,type InputHTMLAttributes} from 'react';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'inputMode'|'value'|'defaultValue'> & {value?:string;defaultValue?:string|number};
export function ManualCountInput({value,defaultValue,onChange,onKeyDown,...props}:Props){
 const [local,setLocal]=useState(String(defaultValue??''));
 return <input {...props} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={value??local} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown')event.preventDefault();onKeyDown?.(event);}} onChange={event=>{if(!/^\d{0,6}$/.test(event.target.value))return;if(value===undefined)setLocal(event.target.value);onChange?.(event);}}/>;
}
