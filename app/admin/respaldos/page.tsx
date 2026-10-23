import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/auth';
import {BackupsPanel} from '../../components/backups-panel';
export const dynamic='force-dynamic';
export default async function BackupsPage(){
  try{await requireAdmin();}catch{redirect('/login');}
  return <main className="admin-wrap"><a href="/">← Volver al inventario</a><h1>Respaldos por turno</h1><p>Cada cierre guarda una copia del inventario en un espacio privado de Supabase. Las correcciones de turnos cerrados generan otra copia.</p><BackupsPanel/></main>;
}
