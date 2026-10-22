import {redirect} from 'next/navigation';
import {requireActor} from '@/lib/auth';
import Home from './components/inventory-app';
export const dynamic='force-dynamic';
export default async function Page(){let actor;try{actor=await requireActor(true);}catch{redirect('/login');}if(actor.mustChangePassword)redirect('/cuenta');return <Home actor={{id:actor.id,name:actor.name,role:actor.role,mustChangePassword:actor.mustChangePassword}}/>;}
