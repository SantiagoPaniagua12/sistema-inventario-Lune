# Acceso y revisión de seguridad · 22 de octubre de 2026

La beta usa Supabase Auth para correo y contraseña. Los nombres de responsables anteriores no son cuentas de acceso ni contraseñas. El administrador inicial autorizado es **lunealtapasteleria@gmail.com**.

## Usar las cuentas

Abre http://127.0.0.1:3000/. Hay dos cuentas de trabajo compartidas y una administradora:

- Cocina: `cocinalune@gmail.com`, acceso corto `cocina`.
- Salón: `salonlune@gmail.com`, acceso corto `salon` (también admite `salón` y `mozos`).
- Administración: `lunealtapasteleria@gmail.com`, con su correo y contraseña propios.

**Las dos cuentas de área todavía no se han creado, por indicación del usuario.** Sus correos ya están rellenados en **Equipo y permisos**. Cuando corresponda, administración elegirá una contraseña de 12 a 128 caracteres para cada área y creará las cuentas desde allí. No se generan contraseñas predeterminadas ni se envían invitaciones o mensajes.

La cuenta de Cocina permite seleccionar a Alex, Rosmery o Joel al registrar producción. La cuenta de Salón permite seleccionar a Shalu, Karla, Nicol, Emilia, Mapi, Diogo o Santiago al abrir un turno, ingresar postres al mostrador y cerrar. Una reposición conserva a su propio mozo responsable aunque otro haya abierto el turno. Los insumos también permiten seleccionar a alguien del área correspondiente.

| Operación | Administración | Cocina | Mozos |
|---|---|---|---|
| Consultar existencias, alertas, historial y PDF | Sí | Sí | Sí |
| Registrar producción de postres | Sí, eligiendo cocinero | Sí, eligiendo cocinero | No |
| Abrir turno | Sí, eligiendo mozo | No | Sí, eligiendo mozo |
| Reponer y cerrar turno | Sí, eligiendo mozo | No | Sí, eligiendo mozo |
| Mover insumos de cocina, frutas y preparados | Sí | Sí | Frutas y preparados |
| Mover bebidas, insumos, empaques y limpieza | Sí | No | Sí |
| Cambiar catálogos y mínimos | Sí | No | No |
| Importar Excel, exportar respaldo y gestionar cuentas | Sí | No | No |

Los permisos se verifican en el servidor y de nuevo dentro de la transacción de inventario. Cambiar el HTML o los metadatos de Supabase no cambia el área autorizada. El nombre seleccionado debe pertenecer a la lista de cocineros o mozos correspondiente. La auditoría guarda la cuenta autenticada y el nombre declarado. **El nombre seleccionado no autentica individualmente al trabajador**: las credenciales se comparten por área.

Solo se permite una cuenta de Cocina y una de Salón, incluso si están desactivadas. Sus áreas son fijas; no se crean cuentas por trabajador ni administradores adicionales desde la interfaz. La cuenta administradora existente se conserva. Desactivar o reactivar un área invalida sus sesiones anteriores. Cerrar sesión revoca inmediatamente esa sesión; cambiar contraseña invalida las demás sesiones de la aplicación, aunque sus JWT todavía no hayan caducado. La contraseña de una cuenta de área es compartida: quien la cambie deberá comunicarla al equipo por un medio privado.

## Configuración privada

Las variables se guardan en `.env.local`, que está excluido de Git. La plantilla sin secretos es `.env.supabase.example`.

- `SUPABASE_URL`: URL pública del proyecto.
- `SUPABASE_PUBLISHABLE_KEY`: clave pública moderna; también se admite la clave antigua `anon`.
- `SUPABASE_SECRET_KEY`: clave secreta moderna, exclusivamente del servidor. Se admite también la antigua `service_role`. Solo se usa en la API de administración de cuentas, protegida por el rol administrador.
- `AUTH_RATE_LIMIT_SECRET`: secreto aleatorio local para anonimizar los identificadores del control de intentos.
- `SUPABASE_DATABASE_URL`: conexión de la aplicación con el rol limitado `lune_runtime`.
- `SUPABASE_SSL_CA_FILE` o `SUPABASE_SSL_CA`: certificado CA; la verificación TLS permanece activa.
- `SUPABASE_ADMIN_DATABASE_URL`: conexión administrativa conservada únicamente para migraciones y mantenimiento locales. **No copiar esta variable al hosting.**
- `APP_ORIGIN`: en producción, origen HTTPS exacto y sin barra final, por ejemplo `https://TU-SITIO.netlify.app`. No se admiten dominios comodín ni se confía en un Host reenviado por el cliente.

En Supabase, **Allow new users to sign up** debe estar desactivado y el inicio con correo habilitado. Una cuenta de Auth sin perfil activo no puede acceder al inventario. El proyecto ya tiene las tablas de acceso y el administrador vinculados.

Para preparar otra base Supabase: `npm run auth:schema`. Crea la primera cuenta confirmada en Authentication → Users → Add user → Create new user y después ejecuta `npm run auth:bootstrap`. Este comando solo vincula el correo administrador indicado arriba si todavía no existe administración. No tiene un endpoint público de configuración.

Para vincular la cuenta de Cocina creada manualmente en Supabase:

```powershell
npm run auth:link -- "cocinalune@gmail.com" "Cocina" "cocina"
```

Crear cuentas desde Equipo y permisos evita usar la consola. Los comandos locales de migración requieren la conexión administrativa; la web funciona con la limitada.

## Protecciones aplicadas

- Todas las API de inventario, PDF, Excel y usuarios requieren una sesión verificada con Supabase. La interfaz también está protegida.
- Cookies de sesión HttpOnly, SameSite=Lax y Secure en producción; no se guardan tokens en localStorage. La cookie tiene una duración deslizante de ocho horas. Las respuestas personales no se almacenan en caché.
- Perfiles y versiones de sesión guardados en PostgreSQL; no se utiliza `user_metadata` como fuente de permisos. Desactivación y revocación se comprueban en cada solicitud.
- Comprobación de Origin obligatoria para escrituras, incluida autenticación; rechazo de solicitudes cross-site.
- Límites persistentes en PostgreSQL: acceso por correo (5/15 minutos) y origen (30/15 minutos), contraseñas (5/15 minutos), escrituras (60/minuto), Excel (6/minuto), PDF (15/minuto) y gestión de cuentas (10/minuto). En Netlify se usa la cabecera de IP de la plataforma; otros entornos comparten un límite global de origen hasta configurar su cabecera de confianza.
- JSON leído con límite antes de parsear; las solicitudes del personal tienen 32 KB y las importaciones de administración hasta 5 MB. Excel tiene límites de compresión, tamaño descomprimido, entradas ZIP, hojas, filas y celdas; no se ejecutan macros ni fórmulas.
- Consultas SQL parametrizadas y valores de catálogos validados. React escapa los textos mostrados.
- CSP con nonce por respuesta, bloqueo de iframes y objetos, `nosniff`, política de referencia y restricciones de cámara, micrófono y ubicación. HSTS en producción. `unsafe-eval` solo en desarrollo; se permiten estilos inline por los gráficos existentes.
- RLS en las tablas y sin acceso directo para `anon` o `authenticated`. La conexión privada `lune_runtime` tiene permisos específicos de operación: no puede crear tablas, leer `auth.users`, borrar productos ni actualizar o borrar la auditoría. Las políticas de este rol corresponden al servidor; los permisos por persona los aplica la API.
- Auditoría de sesiones, contraseñas, gestión de cuentas y operaciones de inventario. Los cambios de inventario y su auditoría se guardan juntos o se revierten juntos. No se registran contraseñas, claves ni tokens.

## Verificación y límites

Las pruebas unitarias cubren permisos, nombres permitidos por área, accesos cortos, administración y límites de JSON. `npm run db:test` siempre utiliza PostgreSQL local con esquemas temporales: valida permisos reales, producción con el cocinero elegido, reposición con un mozo distinto al de apertura, desactivación, auditoría atómica, concurrencia y rollback. No añade operaciones inventadas a Supabase.

`npx tsx scripts/test-auth.ts` comprueba Auth y cookies con una cuenta desechable, sin correos ni movimientos de inventario. Está bloqueado por defecto: requiere configurar un proyecto de pruebas separado y `AUTH_TEST_PROJECT_ALLOWED=true`; no se ejecuta contra el proyecto de Lune al dejar pendiente la creación de las cuentas de área. Elimina la cuenta y sus registros de prueba al terminar. No imprimir su configuración.

La revisión reduce riesgos conocidos; no equivale a garantizar que nunca habrá una intrusión ni a una auditoría externa. Antes de publicar deben configurarse el origen HTTPS definitivo, las variables privadas en el hosting y los respaldos según el plan de Supabase. No desplegar `.env.local`, respaldos de `data/` ni conexiones administrativas. Si una clave se comparte accidentalmente, hay que rotarla. Mantener dependencias y parches actualizados.

La comprobación de seguridad confirmó 20 productos, 38 insumos sin conteo inicial y cero lotes, turnos, movimientos o importaciones inventadas. Solo existe el perfil administrador real; la creación de las cuentas compartidas queda pendiente. Auth, sus sesiones y la revocación se probaron antes del cambio a cuentas de área. Para este cambio se verifican permisos y responsables con pruebas unitarias y PostgreSQL local, sin crear cuentas operativas en Supabase. El alta pública quedó desactivada. El control de intentos también se prueba con solicitudes concurrentes en la base local.

Antes del despliegue conviene fijar también la longitud mínima de contraseña a 12 en Supabase Auth, para aplicar el mismo requisito incluso a clientes ajenos a esta interfaz. El doble factor del panel de Supabase, la recuperación de cuentas y los respaldos deben quedar bajo control del propietario del proyecto. La beta no incluye todavía un flujo de doble factor dentro de la aplicación ni recuperación de contraseña por correo.

Documentación consultada: [Auth en servidor](https://supabase.com/docs/guides/auth/server-side), [seguridad de contraseñas](https://supabase.com/docs/guides/auth/password-security), [roles PostgreSQL](https://supabase.com/docs/guides/database/postgres/roles), [preparación para producción](https://supabase.com/docs/guides/deployment/going-into-prod).
