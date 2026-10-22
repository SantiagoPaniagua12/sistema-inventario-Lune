import {redirect} from 'next/navigation';
import {requireActor} from '@/lib/auth';
import {PasswordForm} from '../components/password-form';
import {BrandLogo} from '../components/brand-logo';
export const dynamic='force-dynamic';
export default async function AccountPage(){let actor;try{actor=await requireActor(true);}catch{redirect('/login');}return <main className="auth-screen"><section className="auth-card"><BrandLogo className="auth-logo"/><h1>{actor.role==='admin'?'Tu contraseña':'Contraseña del área'}</h1><p>{actor.name}, {actor.mustChangePassword?'cambia la contraseña temporal para comenzar.':'puedes actualizar tu contraseña aquí.'}</p>{actor.role!=='admin'&&<p>Esta cuenta es compartida por el equipo del área. Al cambiar la contraseña se cerrarán sus otras sesiones; comunica la nueva contraseña al equipo por un medio privado.</p>}<PasswordForm/><a href="/">Volver al inventario</a></section></main>;}
