'use client';
import {useState,type FormEvent} from 'react';
export function LoginForm(){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const data=Object.fromEntries(new FormData(e.currentTarget));try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error);window.location.assign(result.redirect);}catch(e){setError((e as Error).message);setBusy(false);}}
  return <form onSubmit={submit}><label>Usuario o correo<input type="text" name="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="cocina, salon o correo de administración"/></label><label>Contraseña<input type="password" name="password" required maxLength={128} autoComplete="current-password"/></label>{error&&<p className="alert error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Ingresando…':'Iniciar sesión'}</button><p className="form-note">Después selecciona tu nombre en cada registro. Administración ingresa con su correo.</p></form>;
}
