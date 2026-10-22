import { authConfig } from '@/lib/auth-config';
import { LoginForm } from '../components/login-form';
import {BrandLogo} from '../components/brand-logo';
export const dynamic='force-dynamic';
export default function LoginPage(){return <main className="auth-screen"><section className="auth-card"><BrandLogo className="auth-logo"/><p className="eyebrow">GESTIÓN DE INVENTARIO</p><h1>Bienvenido a tu turno</h1><p>Ingresa con la cuenta de Cocina o Salón.</p>{authConfig()?<LoginForm/>:<div role="alert" className="alert error">El acceso está protegido. Falta configurar la clave pública de Supabase Auth en el servidor. Consulta docs/ACCESO-Y-SEGURIDAD.md.</div>}</section></main>;}
