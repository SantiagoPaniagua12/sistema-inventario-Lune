# Beta 0.2 y preparación de Supabase

## Estado actual

La migración a Supabase se completó el 22 de octubre de 2026. La conexión privada verifica el certificado TLS oficial. Se copiaron las 12 tablas, se compararon todos los campos y se activó `INVENTORY_STORAGE=supabase`. Las tablas tienen RLS activo y sin permisos para los roles `anon` y `authenticated`; la aplicación accede desde el servidor. La comprobación de escritura se revirtió sin dejar registros de prueba. PostgreSQL local permanece intacto y el respaldo previo y el informe de verificación están en `data/migrations`, excluidos de Git.

La aplicación sigue disponible en el puerto 3000 y la pausa temporal de registros ya fue retirada. No se ha publicado la aplicación. El usuario autorizó mantener el puerto activo hasta que pida cerrarlo o cierre la aplicación. El procedimiento siguiente queda como referencia; no volver a ejecutar la copia sobre el proyecto que ya contiene los datos.

Supabase es PostgreSQL administrado. Se conserva el adaptador relacional y las transacciones; no se reemplaza el inventario por un archivo JSON alojado en la nube.

## Nuevas funciones

- Reserva: pestaña de frutas congeladas, controlada únicamente por porciones.
- Insumos y bebidas: los 38 artículos confirmados, con sus variantes y capacidades. El agua es de 355 ml; las leches, de 1.125 ml; las kombuchas, de 355 ml.
- Cajas pequeñas y grandes independientes: una entrada de un millar agrega 1.000 unidades; los retiros descuentan unidades.
- Líquidos: contenido por recipiente en ml, recargas, retiros y conteos mediante porcentaje estimado. Se distingue lo estimado de lo medido y no se puede superar la capacidad.
- Limpieza: catálogo independiente para registrar los artículos reales, sin introducir productos ficticios.
- Cocina: categoría preparada para el futuro catálogo de 200 a 240 insumos. Se verificó con 240 artículos de prueba, no con datos reales inventados.
- Dashboard: total vendido calculado, productos vendidos y ranking por turno. Durante el turno solo se incluyen los conteos válidos ya completados.
- PDF de reposición: incluye agotados y productos por debajo de su mínimo. Puede incluir igualdad al mínimo mediante una casilla. No incluye productos sin conteo; tampoco inventa cantidades de compra.

Los insumos empiezan **sin conteo** y **sin mínimo definido**. Un cero es un conteo real de agotado; no sustituye información faltante. Antes de ingresar o retirar un insumo se registra su conteo inicial.

## Preparación local sin abrir el servidor

```powershell
npm run db:beta2
npm test
npm run db:test
npm run build
```

`db:beta2` crea `insumos` y `movimientos_insumos`, carga el catálogo por identificadores estables sin reemplazarlo y conserva los turnos, lotes, productos y responsables anteriores. La revisión del inventario cambia para rechazar formularios antiguos.

`db:test` usa esquemas temporales; comprueba concurrencia, rollback, historial y una copia completa entre esquemas, incluidos los nuevos insumos. Los esquemas se eliminan al terminar.

Estos comandos no arrancan el servidor web. El servidor de desarrollo ya está autorizado a permanecer activo; conservar esa indicación durante la preparación de Supabase.

## Crear el proyecto Supabase

1. Crear un proyecto nuevo y vacío en la cuenta de Lune. Conservar la contraseña de la base en un gestor seguro.
2. En **Connect**, copiar la conexión PostgreSQL de **Session pooler** para la beta local y la copia desde una red IPv4. Una conexión directa también sirve si la red tiene acceso IPv6. Para la futura aplicación en Netlify usar el pooler de transacciones.
3. Añadir `SUPABASE_DATABASE_URL` a `.env.local`, siguiendo `.env.supabase.example`. No enviarla al chat ni al repositorio.
4. Mantener `INVENTORY_STORAGE=postgres` y los parámetros `PG*` locales durante la copia. La migración necesita leer la base de origen.
5. Ejecutar `npm run supabase:check`. Comprueba conectividad TLS y los roles propios de Supabase. No copia ni imprime registros o credenciales.

El controlador usa TLS con validación de certificado, una conexión por instancia y consultas parametrizadas sin prepared statements nombrados. No se expone la conexión al navegador ni se usan variables `NEXT_PUBLIC_*` para contraseñas.

### Revisión previa y certificado TLS

`npm run supabase:preflight` revisa origen y destino sin copiar datos. Informa la integridad local, conteos, permisos de creación y posibles tablas de inventario que ya existan en Supabase. `npm run supabase:dry-run` ensaya la copia de los datos locales reales en un esquema temporal, compara todos los campos de las 12 tablas y revierte por completo la transacción. No escribe en Supabase.

Si aparece `SELF_SIGNED_CERT_IN_CHAIN`, descarga el certificado CA oficial en **Supabase > Database Settings > SSL Configuration > Download certificate** y guárdalo como `data/certificates/supabase-ca.crt`. Configura en `.env.local`:

```env
SUPABASE_SSL_CA_FILE=data/certificates/supabase-ca.crt
```

En un hosting puede usarse `SUPABASE_SSL_CA` con el contenido PEM. Se conserva `rejectUnauthorized: true` para verificar certificado y nombre del servidor; no se acepta una conexión sin verificación. La configuración detecta cambios de conexión y renueva el pool de la base sin cerrar el puerto web.

## Copiar los datos

Con el proyecto vacío y la cadena configurada, crear primero `data/migration-maintenance.json`. La aplicación debe seguir respondiendo a lecturas, pero rechazar registros con HTTP 503. El script exige que exista esta pausa. Confirmar que no hay operaciones en curso antes de iniciar:

```powershell
npm run supabase:migrate
```

El comando:

1. Obtiene una instantánea consistente de las tablas locales, incluyendo identificadores, fechas, responsables y movimientos.
2. Escribe una copia previa en `data/migrations`, excluida de Git. Contiene información privada de operación y hashes de usuarios, por lo que debe conservarse con acceso restringido.
3. Rechaza un destino que ya tenga tablas de inventario: no borra ni reemplaza datos en Supabase.
4. Crea el esquema y copia las filas dentro de una transacción del destino.
5. Ajusta secuencias y compara el número de filas de todas las tablas. La copia relacional se probó entre esquemas temporales; la conectividad y configuración reales del proyecto deben verificarse al crearlo.
   También compara el contenido completo. Las fechas con zona horaria se serializan en UTC para contrastar ambos servidores sin diferencias de representación.
6. Activa RLS y revoca acceso de `anon` y `authenticated` a estas tablas. Esta versión usa la conexión privada del servidor; no habilita acceso directo desde el navegador.
7. Confirma la copia solo si termina correctamente. PostgreSQL local permanece intacto y la configuración no cambia automáticamente.

Después de comprobar los resultados, seleccionar `INVENTORY_STORAGE=supabase` en `.env.local` y verificar que la aplicación use la nueva conexión. Ese modo exige su propia cadena: si falta, muestra un error y no se conecta silenciosamente al PostgreSQL local. El indicador mostrará **Supabase**. El cambio debe hacerse sin operaciones simultáneas. `npx tsx scripts/verify-supabase-migration.ts` compara origen y destino, comprueba RLS y permisos, prueba una escritura con rollback y verifica la respuesta de la aplicación. Retirar `data/migration-maintenance.json` solo después de verificar todo; confirmar entonces que se reanudaron los registros. No cerrar el puerto durante este procedimiento.

## Límites pendientes antes de publicar

- Actualización del 22 de octubre: Supabase Auth y los permisos por usuario ya están implementados. Los responsables históricos siguen separados de las cuentas autenticadas. Consulta [Acceso y seguridad](ACCESO-Y-SEGURIDAD.md) para configurar las cuentas y las variables previas al despliegue.
- Adaptar la validación de origen, actualmente restringida a loopback, al dominio y las vistas previas autorizadas de Netlify.
- Configurar credenciales en el servidor de Netlify, migraciones y políticas de acceso con mínimo privilegio.
- Verificar conexión y restauración de respaldos en el proyecto real, y probar los flujos con personal de Lune.
- No hay sincronización con Bite Solutions ni descuentos por recetas. Esas capacidades siguen pendientes de documentación y definición.
- Se verificaron tipos, lógica, base relacional, copia real y respuesta de la aplicación con Supabase. La navegación completa con personal de Lune sigue pendiente.

## Fuentes técnicas

- [Conexiones PostgreSQL y pooler de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [Acceso seguro y diferencias entre conexión privada y Data API](https://supabase.com/docs/guides/database/secure-data).
