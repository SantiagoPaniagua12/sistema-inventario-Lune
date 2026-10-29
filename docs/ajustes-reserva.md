# Ajustar unidades en reserva congelada

En **Reserva congelada → Postres y bollería → Ajustar unidades**, escribe el total físico correcto, selecciona al cocinero responsable e indica el motivo. La vista previa muestra la cantidad anterior, la nueva y la diferencia. Administración y Cocina pueden guardar el ajuste, incluso sin un turno abierto o sin producción previa.

Se admiten enteros de 0 a 100 000. El ajuste actualiza las alertas y queda en Historial con cuenta, responsable, fecha, motivo y totales. Las disminuciones se distribuyen entre los lotes más antiguos; los aumentos se asignan al más reciente. El primer conteo crea un lote identificado como conteo inicial por ajuste, con producción declarada en cero.

**Corregir registro** sigue siendo la acción para corregir la cantidad producida de un lote. Un ajuste de reserva no modifica producción, mostrador, horneados ni ventas calculadas. Las frutas mantienen su acción de Conteo.

Verificación: `npm test`, `npm run typecheck`, `npm run build` y `npm run db:reserve-test`. La última utiliza un esquema temporal de PostgreSQL local, lo elimina al terminar y no utiliza Supabase.

Al reducir un ingreso al mostrador, se devuelven primero las unidades de los lotes más recientes utilizados en ese turno, sin exceder lo retirado de cada lote. Los postres regresan al congelador y la bollería a su stock horneado de origen. El orden de lectura del historial no cambia esta distribución. La devolución y la corrección del mostrador se confirman juntas o se revierten completas si falla el guardado.
