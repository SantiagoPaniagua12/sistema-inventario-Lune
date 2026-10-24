# Permisos e historial por cuenta

Salón no accede a Reserva congelada ni a Salidas al mostrador. Cocina no accede a Ventas por turno ni a Turno actual. Administración conserva todas las secciones. Las demás consultas y permisos de insumos se mantienen.

La API aplica la misma matriz que el menú. Las respuestas de lectura y escritura se filtran por rol: Salón recibe solo disponibilidad agregada para su formulario de ingresos, sin identificadores de lotes, fechas, responsables de producción ni mínimos de reserva; Cocina recibe lotes de producción y los ingresos por producto/turno para el reporte de salidas, sin entradas, cierres ni ventas del mostrador. Los datos completos siguen utilizándose exclusivamente en las transacciones del servidor y los respaldos.

Salón conserva las ventas históricas importadas de Excel, excluyendo los registros de reserva. Cocina recibe de esos históricos únicamente las cantidades ingresadas al mostrador. Las alertas respetan los datos permitidos y no muestran reserva a Salón ni stock de mostrador a Cocina.

El historial de cada cuenta usa `auditoria_acceso.auth_id`, nunca el nombre elegido por el trabajador. Incluye filtros de fecha y tipo y páginas de 50 operaciones. Los nuevos registros guardan, en la misma transacción, el turno real, equipo, productos, cantidades y valores de correcciones. Los movimientos de insumos dentro de cada sección también se filtran con los identificadores auditados de esa cuenta.

Las operaciones antiguas con cuenta conocida conservan los datos que realmente se registraron; si no quedó la cantidad, se muestra como no disponible. Los movimientos sin cuenta no se atribuyen por su nombre y permanecen en las consultas completas de Administración. No se modifican registros anteriores ni se requiere una migración de la base.

Comprobaciones: matriz de secciones, respuestas sin datos restringidos, formulario de ingreso sin lotes, alertas y Excel por rol, historial autenticado y paginado, intentos de consultar otra cuenta, producción y descuento FIFO, correcciones, borradores de cierre y copia/recuperación. Las pruebas con PostgreSQL utilizan esquemas temporales locales, nunca registros inventados en Supabase.

Desde un cierre o corrección del historial propio, Salón puede pulsar **Ver conteo del turno** para consultar y corregir ese conteo mientras las reglas de corrección existentes lo permitan. El selector global de turnos y los movimientos sin cuenta siguen reservados para Administración.
