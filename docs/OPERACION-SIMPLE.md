# Operación simplificada de Lune

Se mantienen las tres cuentas: Administración, Cocina y Salón. Los nombres del personal son responsables de registro, no cuentas individuales.

## Salón

1. Abrir turno con el equipo: mañana requiere 1–4 mozos; tarde 2–4. La apertura muestra uno o dos campos respectivamente y permite agregar hasta cuatro sin duplicados.
2. Si llega alguien después, usar **Agregar más mozos** con el turno abierto. Queda registrada la hora de incorporación. No se sustituyen responsables históricos.
3. En **Ingresar al mostrador**, escribir las cantidades de todos los productos que ingresan y pulsar **Guardar ingresos**. Vacíos y ceros no generan movimientos. No se selecciona lote ni persona.
4. La asignación de reserva prioriza la fecha de producción más antigua, desempata por orden de registro y continúa con el siguiente lote cuando se agota. Todo el envío se guarda en una transacción: si falla un producto, no se descuenta ninguno y se mantienen los campos del formulario.
5. Escribir **Stock al cierre**. Los conteos se guardan como borrador automáticamente; un campo vacío sigue pendiente y cero es un conteo válido. Revisar el indicador **Guardado**.
6. Cerrar sesión espera los guardados pendientes. Si falla la conexión, no se confirma el cierre de sesión y se conserva una copia de recuperación en el navegador. Al volver a Salón se recupera el borrador del turno. Cambiar a Cocina no borra lo guardado; Cocina no puede modificar estos conteos.
7. Si otra pestaña cambia el mismo producto, elegir qué valor conservar. No se sobrescribe silenciosamente la otra versión. Los campos de productos distintos se actualizan independientemente.
8. Al cerrar el turno se validan las versiones guardadas y los conteos; se toman automáticamente todos los responsables del turno. La entrada del siguiente turno sigue siendo el cierre anterior.

## Cocina

- **Agregar producción** muestra todos los productos. Indicar cantidades, seleccionar cocinero y fecha una sola vez y guardar. Cada producto obtiene su registro interno de producción.
- **Corregir registro** en cada producto muestra la fecha y cantidad registrada, sin códigos técnicos. Elegir el registro, escribir la cantidad total correcta, el cocinero que corrige y el motivo.
- Las correcciones conservan la producción original y agregan un movimiento compensatorio. No es posible reducir una producción por debajo de las unidades ya retiradas al mostrador.
- **Reportes y consultas** conserva las ventas, salidas al mostrador e históricos; no se confunden con las acciones diarias.

## Preparación y compatibilidad

Las migraciones `012_operacion_simple.sql` y `013_borradores.sql` añaden equipos, identificadores de operación y borradores. Son adicionales al esquema existente, no reemplazan tablas ni inventan existencias. Los turnos existentes conservan su responsable como primer integrante; un turno de tarde antiguo con una persona puede terminar normalmente. El mínimo de dos se exige a las aperturas nuevas.

El instalador usa `SUPABASE_ADMIN_DATABASE_URL` solo localmente, nunca en Netlify. No modifica `.env.local` ni imprime credenciales. Antes de aplicar crea un respaldo privado en `data/backups` y comprueba que los valores anteriores de catálogo, lotes, movimientos y cierres sean idénticos. Las tablas nuevas mantienen RLS y no permiten acceso directo a `anon` ni `authenticated`.

```sh
npm run db:simple
npm run db:simple -- --apply
```

Primero se ejecuta la consulta de preparación; el segundo comando aplica la actualización a la base configurada. El servidor web conserva el rol limitado `lune_runtime`. Los comandos de desarrollo y pruebas no deben usar la conexión administrativa para servir solicitudes.

## Verificación

```sh
npm test
npm run db:test
npm run db:beta-test
npm run build
npm run security:check
```

`db:test` y `db:beta-test` solo crean esquemas temporales en PostgreSQL local y los eliminan al finalizar. Cubren registros múltiples FIFO, reintentos sin duplicación, fallos a mitad de escritura, equipos, recuperación de borradores, versiones concurrentes, rechazo de sesiones revocadas, permisos y corrección de producción parcialmente utilizada. Nunca crean movimientos ficticios en Supabase.
