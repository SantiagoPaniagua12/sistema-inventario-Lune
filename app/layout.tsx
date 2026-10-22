import type { Metadata } from 'next';
import './globals.css';
import './catalog.css';
import './readability.css';
import './beta2.css';
import './alerts-excel.css';
import './auth.css';
import './brand.css';

export const metadata: Metadata = { title: 'Lune · Inventario', description: 'Beta 0.2 de producción, insumos e inventario por turnos para Lune.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
