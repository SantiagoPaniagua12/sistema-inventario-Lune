# Lune · Inventario beta 0.2

Aplicación web en Next.js + React + TypeScript, con Supabase Auth y persistencia relacional en Supabase. PostgreSQL local se conserva para pruebas; todavía no hay conexión a caja ni n8n.

La operación simplificada incorpora ingresos de varios productos, consumo automático de los lotes más antiguos, equipos de hasta cuatro mozos, borradores de cierre recuperables y corrección de producción. Consultar [Operación simplificada](docs/OPERACION-SIMPLE.md) para preparar la actualización y usar los nuevos formularios.

La beta 0.2 agrega frutas por porciones, insumos, bebidas, empaques, líquidos, limpieza, PDF de reposición y dashboards de venta calculada. El catálogo nuevo incluye 38 artículos confirmados, sin inventar existencias iniciales ni mínimos. La categoría Cocina admite la futura ampliación de 200 a 240 insumos.

También incorpora alertas de todas las secciones y avisos dentro del sistema, mínimos de congelador e importación histórica de Excel con vista previa. Admite los bloques por postre y fechas horizontales de Lune y registros de moldes producidos/usados por turno. Consultar [Alertas e importación de Excel](docs/alertas-e-importacion-excel.md).

**El usuario autorizó mantener el puerto 3000 activo hasta que pida cerrarlo o cierre la aplicación.** Usar `npm run dev` durante los ajustes para conservar el servidor y reflejar los cambios sin reiniciarlo.

La aplicación ya usa Supabase y requiere iniciar sesión con Supabase Auth. El 22 de octubre de 2026 se copiaron y verificaron las 12 tablas de inventario y se añadieron cinco tablas de acceso, sesiones y auditoría. PostgreSQL local se conserva para pruebas. Consulta primero [Acceso y seguridad](docs/ACCESO-Y-SEGURIDAD.md); la preparación de la migración está en [Beta 0.2 y Supabase](docs/supabase-beta-02.md).

## Inicio

Requiere Node.js 20.9 o superior y npm.

```sh
npm install
npm run dev
```

Abrir http://127.0.0.1:3000. Para compilar: `npm run build`; para ejecutar esa compilación: `npm start`.

## PostgreSQL local

Conexión configurada para `localhost:5433`, base `sistemainventario`, usuario `postgres`. Las credenciales se guardan en `.env.local`, excluido de Git. No compartir ese archivo ni imprimir su contenido.

1. Si no existe `.env.local`, copiar `.env.example` y completar `PGPASSWORD` localmente.
2. Crear las ocho tablas de `database/schema.sql` solamente si aún no existen. No ejecutar ese esquema sobre tablas ya creadas.
3. Ejecutar `npm run db:check`: comprueba conexión y columnas requeridas sin escribir datos.
4. Ejecutar `npm run db:setup`: agrega `inventario_control` para controlar revisiones, prepara categorías y ubicaciones, y carga el catálogo inicial solo si la tabla productos está vacía. Conserva el catálogo existente. No importa datos JSON.
5. Configurar `INVENTORY_STORAGE=postgres` en `.env.local` y reiniciar el servidor.

En modo PostgreSQL, la aplicación lee y escribe en las tablas relacionales. El saldo congelado se obtiene del historial de movimientos. Reposiciones, horneados y cierres se confirman dentro de transacciones con un bloqueo compartido entre procesos de la aplicación y revisión optimista. La interfaz muestra **PostgreSQL local** cuando la lectura proviene de esa base.

Los responsables históricos se conservan en `usuarios` por nombre y área. Sus marcadores `!` no son contraseñas. El acceso real se guarda en Supabase Auth y `perfiles_acceso`: hay una cuenta compartida de Cocina, una de Salón y la cuenta administradora. Cocina selecciona al cocinero una vez por registro de producción. Salón selecciona al equipo al abrir el turno; los ingresos y el cierre toman ese equipo automáticamente. La auditoría conserva la cuenta autenticada y los responsables declarados; esos nombres no suponen una autenticación individual. Los lotes y turnos anteriores mantienen su autoría.

El botón de exportar descarga una copia del estado de inventario para consulta; no es un respaldo completo de PostgreSQL. La restauración JSON está desactivada en este modo. Utilizar `pg_dump` y `pg_restore` para respaldos completos de la base. Los saldos iniciales del primer turno representan el conteo del mostrador; los turnos posteriores heredan el cierre sin duplicar entradas de stock.

`npm run db:test` verifica el adaptador real en un esquema temporal exclusivo que crea y elimina. Requiere permisos para crear esquemas. Prueba retiro por unidades, cierre, traspaso, concurrencia y rollback si falla el segundo movimiento de una reposición. No escribe movimientos de prueba en las tablas de `public`.

## Primera prueba

1. En **Productos**, revisar los 17 postres proporcionados para Lune, añadir los productos necesarios y confirmar los mínimos. Todos se cuentan por unidades; los mínimos iniciales son provisionales. El catálogo inicial se usa al crear datos nuevos; no reemplaza catálogos ya guardados.
2. En **Turno actual**, abrir el primer turno con fecha, equipo de mozos y conteo físico inicial. Mañana requiere al menos uno y tarde al menos dos; máximo cuatro sin repetir.
3. En **Reserva congelada → Agregar producción**, escribir las cantidades de los productos preparados, el cocinero y la fecha una vez. Croissants y rolls se registran como unidades formadas congeladas.
4. En **Ingresar al mostrador**, escribir cantidades para varios productos y guardar una vez. Los lotes se asignan internamente por antigüedad, incluyendo varios lotes si hace falta. Ingresar 5 unidades resta 5 de reserva y suma 5 al mostrador, sin conversiones.
5. Las unidades que paga un trabajador se incluyen en las unidades vendidas calculadas al cerrar; no hay un formulario de descarte.
6. Contar todos los productos al final del turno, incluso los que están en cero. Los borradores se guardan automáticamente; esperar a **Guardado**, revisar y cerrar. No se vuelve a seleccionar el nombre del mozo.
7. Abrir el siguiente turno: recibirá automáticamente el cierre anterior. Consultar cierres y movimientos en **Historial**.

Venta calculada = entrada + ingresos − conteo al cierre. Incluye las unidades pagadas por trabajadores. No representa ventas verificadas de caja. Los ajustes guardados antes de esta versión conservan su efecto en los conteos históricos y se señalan en el turno cuando existen. Durante el turno el disponible es anterior al conteo y no descuenta ventas en tiempo real.

El catálogo incluye croissant clásico, de chocolate y de almendras como productos separados. Sin caja no hay desglose de sabores de relleno que compartan una misma base.

## Datos y límites de la beta

- Con `INVENTORY_STORAGE=json`, la persistencia del inventario es `data/inventory.json`, creada al guardar el primer movimiento. La operación autenticada y los borradores compartidos requieren PostgreSQL/Supabase. La copia de recuperación de conteos pendientes usa almacenamiento del navegador, separado por cuenta, turno y pestaña; no reemplaza el guardado en la base.
- En modo JSON se serializan escrituras y se reemplaza el archivo: ejecutar **un solo proceso del servidor** y usar disco persistente. En modo PostgreSQL se utilizan transacciones y bloqueo entre procesos que escriben desde la aplicación. Las escrituras manuales externas no participan de ese bloqueo ni actualizan la revisión.
- El servidor de desarrollo solo escucha en `127.0.0.1`; el sitio publicado exige Supabase Auth y permisos de área.
- El último cierre admite correcciones auditadas antes de que existan cierres posteriores. Todavía no hay ajustes de apertura ni transferencias entre locales. Las correcciones de ingreso revierten los movimientos correspondientes sin borrar el historial.
- No configura vencimientos, descongelación ni condiciones sanitarias. Estos parámetros deben definirse con la pastelería; no hay alertas sanitarias en esta beta.
- Los mínimos se señalan en el turno abierto y los cierres. Durante un turno se usa el disponible estimado (sin descontar ventas hasta el conteo), no el stock real en tiempo real.
- Los movimientos nuevos registrados durante un turno se vinculan a él en Historial. Producción fuera de turno y movimientos anteriores a esta versión aparecen aparte, sin atribuirlos a un turno por suposición.
- Fechas operativas y presentación de movimientos en `America/Lima`.
- No incluye caja, facturación electrónica, n8n, recetas ni ingredientes.
- El respaldo contiene responsables y datos de operación. Conservarlo con acceso restringido.
- Tipografía remota opcional; si no hay internet, se usan fuentes del sistema.

## Validación

```sh
npm test
npm run typecheck
npm run build
```

Los tests cubren retiro por unidades, traspaso de turnos, compatibilidad de ajustes anteriores, cierres, revisiones concurrentes, alta de productos, asociación de movimientos y validación de respaldos.

## Próxima etapa

Parametrizar conservación por etapa e importar ventas externas con identificadores idempotentes. Mantener separadas la venta importada y la venta calculada para evitar descuentos dobles.

## Conteo por unidades y fotografías

La actualización `npm run db:units` establece el factor técnico del catálogo en 1. No reescala saldos, no cambia lotes previos ni reescribe movimientos o cierres. Los campos de rendimiento y las etiquetas de unidades antiguas permanecen únicamente por compatibilidad; ya no se muestran ni se usan para multiplicar retiros. El cliente rechaza solicitudes antiguas que intenten ingresar una cantidad distinta de la retirada.

Las fotografías proporcionadas están en `public/images`. La sección Productos se muestra sin imágenes. Las fotografías individuales del mostrador y la reserva se asocian solo a los dos postres identificados por el usuario: Pastel de Queso Japonés y Delicia Multifloral. No se asignan nombres por conjetura a los demás postres de la foto.
## Acceso con usuarios

**Salidas al mostrador** muestra los ingresos netos desde reserva por producto, fecha, turno de día (mañana), tarde y total diario. Permite consultar solo postres, croissants y rolls, o ambos. Utiliza los ingresos guardados y corregidos de cada turno; no suma la entrada heredada ni confunde las ventas con salidas de reserva. Los turnos abiertos muestran su avance; los históricos de Excel se identifican como tales.

**Ingresar al mostrador** permite registrar varios productos juntos. Los lotes se mantienen internos y se consumen por antigüedad; si coinciden las fechas, se usa primero el registrado antes. Una cantidad puede repartirse entre varios lotes, sin intervención del mozo. Las correcciones revierten las unidades de los lotes afectados y los aumentos respetan la misma prioridad.

Salón y administración pueden usar **Corregir** en la tabla de turnos para cambiar el ingreso total y el stock al cierre del turno abierto o del último cierre. Se exige explicar el motivo y se toma automáticamente el equipo del turno. El historial conserva los valores anteriores. Los ingresos se compensan internamente con sus lotes reales, sin borrar movimientos ni permitir devolver más de lo retirado. Las ventas se recalculan y un cierre corregido actualiza la entrada del siguiente turno abierto. No se modifican cierres con otros cierres posteriores ni históricos importados de Excel. Cocina tiene una corrección separada de producción.

El catálogo contiene 21 productos: 17 postres y cuatro productos de viennoiserie, incluido el croissant de almendras para turnos y reserva. Su alta existente en Supabase se realizó con `npm run catalog:almond`, sin cargar existencias ficticias. El comando es idempotente y conserva los cierres anteriores. El logo proporcionado por Lune se usa en el inicio de sesión, el menú y el pie de página.

La beta requiere iniciar sesión. Las cuentas compartidas de Cocina (`cocinalune@gmail.com`) y Salón (`salonlune@gmail.com`) ya están creadas y activas, además de administración. También admiten los accesos cortos `cocina` y `salon`. Sus contraseñas las gestiona Lune. Consulta [la guía de acceso y seguridad](docs/ACCESO-Y-SEGURIDAD.md).
