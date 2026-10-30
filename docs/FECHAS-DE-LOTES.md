# Corregir fechas de producción

En **Reserva congelada → Modificar fecha**, Cocina y Administración seleccionan un lote e indican la fecha correcta, el cocinero y el motivo. El selector incluye lotes con saldo, parcialmente utilizados y agotados. La vista previa muestra ambas fechas. Se admiten fechas reales hasta el día actual de Lima; no se guardan cambios sin diferencia.

La corrección conserva el identificador del lote, la producción declarada, las unidades disponibles y todos los movimientos anteriores. La fecha corregida determina el orden de los próximos retiros de reserva y de los próximos horneados. Los empates conservan el orden de registro. La fecha de horneado y el orden de uso de los productos ya horneados permanecen independientes.

En PostgreSQL se actualiza únicamente `lotes.fecha_produccion` y se registra **Fecha de producción corregida** en la auditoría existente, con cuenta autenticada, cocinero, motivo, fechas anterior/nueva y hora de corrección. No se crean movimientos de stock ni movimientos de cantidad cero. En modo JSON se conserva un historial opcional `lotDateCorrections` que viaja en los respaldos. Los respaldos anteriores siguen siendo válidos.

La API valida la fecha anterior esperada y la revisión del inventario. Si otra sesión cambia la fecha, hay que cerrar y volver a abrir el formulario para revisar los datos actualizados. Los reintentos en PostgreSQL utilizan el identificador de operación y no duplican la auditoría.

## Permiso de la conexión de la aplicación

No hay cambios de esquema. La conexión limitada `lune_runtime` necesita únicamente `UPDATE(fecha_produccion)` sobre `public.lotes`; no necesita modificar otras columnas.

`npm run db:lot-dates` comprueba ese permiso sin escribir. Una vez autorizado el cambio en la base compartida, `npm run db:lot-dates -- --apply` guarda un respaldo privado, concede exclusivamente ese permiso y verifica que todo el inventario siga igual. No cambia fechas ni cantidades. Para comprobar PostgreSQL local, añadir `--local`.

## Verificación

- `npm test` incluye fechas inválidas/futuras, lotes usados/agotados, FIFO, horneados, permisos, conflictos e historial JSON.
- `npm run db:lot-date-test` usa PostgreSQL local en un esquema temporal y comprueba auditoría, reintentos, concurrencia, rollback y el permiso limitado a la columna. No modifica Supabase.
- `npm run typecheck` y `npm run build`.
- Revisión en navegador en escritorio y móvil: selección de lote agotado, vista previa, guardar, cancelar, fecha futura y fecha cambiada en otra sesión.
