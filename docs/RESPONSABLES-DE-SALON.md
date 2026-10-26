# Responsables de Salón

La cuenta compartida Salón inicia sesión mediante Supabase Auth. Los nombres seleccionados al abrir un turno son responsables operativos de la tabla usuarios, independientes de esa cuenta y de sus permisos.

Shalu, Karla, Nicol, Emilia, Mapi, Diogo y Santiago pueden ser responsables principales en cualquiera de los dos horarios. La mañana requiere entre uno y cuatro mozos; la tarde requiere entre dos y cuatro. El horario no limita qué nombres se pueden elegir.

El bloqueo de Santiago se debía a un registro previo marcado como cocina. Se corrigió a mostrador conservando su identificador. Karla quedó registrada en mostrador. Se verificó que turnos, conteos, existencias, movimientos y perfiles de acceso no cambiaran.

- `npm run staff:check` comprueba los siete registros sin modificar datos.
- `npm run staff:check -- --apply` prepara responsables faltantes y corrige la metadata autorizada. Usa la conexión administrativa local y guarda una copia privada previa en data/backups. Rechaza duplicados y registros con historial de otra área que necesiten revisión.
- `npm run db:staff-test` reproduce el problema y verifica las 14 combinaciones de mozo/horario en un esquema PostgreSQL local aislado, además de comprobar idempotencia y protección del historial.

Los datos operativos de producción no se utilizan como prueba de apertura ni cierre.
