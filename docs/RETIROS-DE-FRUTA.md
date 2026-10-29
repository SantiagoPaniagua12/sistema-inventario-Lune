# Frutas congeladas por turno

En **Turno actual → Frutas congeladas**, Salón y Administración pueden registrar cada retiro. Se elige la fruta, las porciones y un mozo del equipo del turno abierto. No se distingue entre jugos y frappés. Se comparte el mismo stock que **Reserva congelada → Frutas por porciones**: no hay un segundo inventario.

Cada retiro descuenta porciones inmediatamente. La tabla muestra existencias y consumo efectivo del turno. No se permiten cantidades vacías, cero, negativas, decimales, superiores al stock o frutas sin conteo inicial. Sin turno abierto se puede consultar el stock, pero no retirar. El cierre no descuenta la fruta otra vez ni la incorpora a las ventas calculadas de postres.

## Corregir y anular

Cada retiro muestra las acciones **Corregir**, **Anular** y **Ver historial**. Corregir permite cambiar la fruta o las porciones; ambas acciones requieren un motivo. La vista previa muestra el efecto en el stock.

Si se registraron cinco porciones y eran tres, vuelven dos al stock. Si eran siete, se retiran dos adicionales. Al cambiar la fruta, vuelve la cantidad vigente de la anterior y se retira la nueva. Anular devuelve la cantidad vigente completa y conserva el registro con cantidad efectiva cero. Las correcciones posteriores trabajan sobre el estado vigente, no sobre la cantidad original.

Salón corrige mientras el turno esté abierto y selecciona a un mozo del equipo actual. Administración también puede corregir turnos cerrados desde **Historial → Retiros de fruta por turno**, seleccionando el turno. Se ajusta el stock actual sin reabrir turnos ni modificar ventas. Se conserva al mozo original y se registra al corrector, fecha, motivo y valores anteriores/nuevos.

## Preparación de la base

`npm run db:fruits` comprueba el estado sin modificar datos. `npm run db:fruits -- --apply` aplica `database/020_retiros_fruta.sql` en la conexión configurada; si es Supabase, necesita la conexión administrativa y autorización para modificar esa base. Para PostgreSQL local se añade `--local`.

La preparación guarda un respaldo privado en `data/backups`, añade únicamente las referencias opcionales a turno y retiro original, verifica que los datos existentes permanezcan iguales y actualiza la revisión. Es repetible. Los movimientos antiguos conservan su stock y no se asignan a turnos por suposición. Preparar la base antes de publicar el código nuevo; esta función no requiere publicar ni reiniciar el sitio para aplicar sus columnas compatibles.

Las correcciones se guardan como movimientos compensatorios en una transacción. Los identificadores de operación evitan repetir descuentos en reintentos; las versiones de retiro y de inventario impiden sobrescrituras. Los respaldos JSON conservan las referencias y los respaldos de cierres incluyen el historial; corregir un turno cerrado actualiza su respaldo cuando el servicio está habilitado.

## Verificación

- `npm test`: lógica, permisos, interfaz y regresiones.
- `npm run db:fruit-test`: esquema temporal de PostgreSQL local, migración repetible, persistencia, rollback, reintentos, concurrencia y correcciones tras cierre. No usa Supabase.
- `npm run typecheck` y `npm run build`.
- Verificación en navegador de registro, corrección de cantidad/fruta, anulación y Administración después del cierre, en escritorio y móvil.
