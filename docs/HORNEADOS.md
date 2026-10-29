# Horneados y uso en platos

Cocina y Administración disponen de Horneados para todos los productos de Bollería. Registrar un horneado descuenta de los lotes congelados más antiguos y aumenta el stock horneado pendiente de usar o enviar. Cada movimiento conserva cocinero, fecha y turno de Cocina. Salón ingresa al mostrador únicamente lo que recibe: la bollería se descuenta de horneados y los postres de congelados. Las correcciones retornan al origen de cada ingreso.

Focaccia y Pan para Tostada se controlan exclusivamente en Cocina. No aparecen en Turno actual, los conteos iniciales ni el formulario de ingresos de Salón. Cocina registra las unidades usadas en platos en su fecha y turno, descontando de horneados. Esto mide consumo de pan, no transacciones de caja. Los movimientos y turnos anteriores se conservan.

Los horneados del turno y los usos se filtran por fecha y mañana/tarde; el stock pendiente reúne todos los turnos. No se inventa stock horneado a partir de ingresos históricos.

## Preparación

`npm run db:baking` inspecciona. `npm run db:baking -- --apply` aplica 019, añade la ubicación Horneados y marca los dos panes. Crea copia privada en data/backups, usa el bloqueo común de escrituras y verifica que los únicos cambios sean esos metadatos. Se cancela si los panes tienen movimientos o saldos en un turno abierto para evitar descartar existencias. Aplicar el esquema antes de publicar la versión nueva.
