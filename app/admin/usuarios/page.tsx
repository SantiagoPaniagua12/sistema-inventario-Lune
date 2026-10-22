import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {UsersPanel} from '../../components/users-panel';
export const dynamic='force-dynamic';
export default async function UsersPage(){try{await requireAdmin();}catch{redirect('/login');}return <main className="admin-wrap"><a href="/">← Volver al inventario</a><h1>Cuentas de trabajo</h1><p>Dos cuentas compartidas: Cocina y Salón. La cuenta administradora se conserva aparte. En cada operación, el trabajador selecciona su nombre.</p><UsersPanel/></main>;}
