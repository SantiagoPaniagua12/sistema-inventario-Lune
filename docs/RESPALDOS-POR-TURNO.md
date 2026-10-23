# Respaldos automáticos al cerrar turno

Cada cierre confirmado en Supabase crea una copia operativa en el bucket privado `lune-cierres`. Una corrección de un turno ya cerrado genera otra copia; no reemplaza el cierre original.

La copia incluye catálogo, responsables de registro, lotes, movimientos, turnos, equipos, insumos e importaciones históricas. Conserva tanto el estado legible del inventario como las 15 tablas operativas para recuperación técnica. Los hashes de contraseña de usuarios de registro se sustituyen por `!` y sus correos por NULL; no incluye Supabase Auth, sesiones, claves, certificados ni la auditoría de acceso. No es un `pg_dump` completo del proyecto ni incluye otros objetos de Storage.

## Entrega y reintentos

- La cola `respaldos_turno` conserva la copia exacta dentro de la misma transacción que cierra el turno. No puede confirmarse un cierre nuevo sin registrar su copia pendiente. Una escritura fallida revierte ambas operaciones.
- Después del COMMIT, `after` de Next.js intenta subir una copia pendiente sin bloquear la respuesta del cierre. También se intenta al consultar el inventario. Nunca se captura un estado posterior para sustituir un cierre anterior.
- Un proceso programado de Netlify (`shift-backups`) revisa una copia pendiente cada 15 minutos, incluso sin navegadores abiertos. Solo se ejecuta en el despliegue de producción; Netlify no expone esta función como endpoint público.
- Se usa una reserva de dos minutos por trabajo para evitar subidas simultáneas. Si un proceso termina inesperadamente, otro puede retomar la copia. Los fallos se reintentan con espera creciente de hasta una hora; cada ejecución procesa como máximo una copia para respetar el tiempo de Netlify.
- Los objetos son inmutables: no se permite sobrescribir un archivo existente. Si la subida ya existía, se descarga y se verifica el SHA-256 del JSON canónico. Solo después de comprobarlo se marca «Guardado y verificado» y se elimina la copia temporal de la cola para ahorrar espacio en la base.
- Si falla Storage, el cierre sigue confirmado y la interfaz muestra «respaldo pendiente». Un fallo al preparar la copia en PostgreSQL sí revierte el cierre para evitar un cierre sin respaldo pendiente.

No hay borrado automático de copias ni retención limitada configurada. Vigilar el espacio de Storage y definir una retención antes de acumular años de archivos.

## Preparación

1. Mantener `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_DATABASE_URL` y el certificado en las variables privadas del servidor, con alcance Functions en Netlify. No se necesitan claves nuevas. La conexión administrativa sigue exclusivamente local.
2. Ejecutar `npm run backups:setup -- --apply` desde el equipo autorizado. El instalador guarda un respaldo privado previo, crea `database/014_respaldos_turno.sql`, comprueba que las tablas operativas no cambiaron, crea el bucket privado y verifica subida, lectura del servidor y rechazo de lectura pública/anónima con un archivo sin datos reales. No inventa turnos ni cierra los existentes.
3. Publicar el código. Verificar en Netlify que `shift-backups` aparece como Scheduled con frecuencia de 15 minutos. El primer respaldo de turno se genera con el próximo cierre real; no se inventan copias retroactivas de cierres antiguos.

Si la red del equipo bloquea la conexión PostgreSQL, puede ejecutarse `database/014_respaldos_turno.sql` desde SQL Editor de Supabase y luego `npx tsx scripts/shift-backup-storage.ts` para preparar/verificar el bucket mediante HTTPS. El SQL comprueba las políticas de lectura de Storage antes de crear la tabla. Publicar únicamente cuando la tabla esté creada; el backend necesita registrar la copia pendiente para poder confirmar un cierre.

Si existen políticas de lectura para clientes en `storage.objects`, el instalador se detiene para revisarlas. No crea políticas para usuarios anónimos o autenticados. El backend comprueba que el bucket siga siendo privado antes de subir y descargar.

## Consulta y recuperación

Administración tiene el enlace **Respaldos** en el inventario. Puede ver las últimas 100 copias, sus estados, descargar un archivo `.json.gz` verificado y reintentar una copia pendiente. Cocina y Salón solo ven el aviso operativo de pendientes; no acceden al historial ni a descargas.

Los archivos se agrupan por año/mes, fecha, turno y revisión. El SHA-256 se conserva en PostgreSQL. La recuperación se hace con asistencia técnica: descargar y verificar la copia, probarla primero en una base aislada con el mismo esquema y usar las tablas operativas para restaurar los registros y sus secuencias. No subir el archivo comprimido al importador JSON de la beta: son formatos diferentes. El inicio de sesión y las claves se conservan por separado; no se restauran desde estas copias.

Las pruebas `npm run db:backup-test` reconstruyen un inventario de prueba en un segundo esquema local y comprueban cantidades, fechas, equipos e historial. No restauran ni insertan datos ficticios en el proyecto de Lune.

Estas copias protegen de errores operativos mientras el proyecto existe. Eliminar el proyecto de Supabase elimina también su bucket; una copia externa independiente sigue siendo necesaria para cubrir ese caso.

Referencias: [Storage privado](https://supabase.com/docs/guides/storage/serving/downloads), [funciones programadas de Netlify](https://docs.netlify.com/build/functions/api/).
