# Conteos manuales e insumos de salón

Los campos de cantidades de producción, reposición, conteos, correcciones, mínimos, capacidades y presentaciones se editan escribiendo o borrando. La rueda y las flechas arriba/abajo no modifican valores. Se mantienen las cantidades enteras, los ceros válidos y los límites de cada operación. Los porcentajes de líquidos conservan un decimal y admiten coma, normalizada antes de guardar.

El guardado automático del conteo de Salida continúa funcionando. Los formularios de producción e insumos conservan su botón Guardar.

## Catálogo

**Empaques, por unidades:** sorbetes de plástico, vasos de frapp descartables, vasos de café grandes y pequeños, bolsas de papel grandes, medianas y pequeñas, cucharitas descartables.

**Papelería:** papel de impresión de boletas e Izipay (por rollos), stickers logos de Lune y tarjetas de presentación (por unidades).

Los nuevos productos no incluyen existencias ni mínimos supuestos. Si las bolsas de papel ya existen en Limpieza, se reutiliza su identificador y se cambia únicamente la categoría, conservando sus conteos, mínimos e historial. Si una coincidencia usa otra unidad o hay nombres duplicados, se cancela la actualización para revisar los datos.

## Preparación y publicación

1. Pruebas automáticas, prueba del campo numérico en navegador y compilación.
2. `npm run catalog:salon -- schema`: prepara Papelería y rollos, sin cambiar registros existentes; guarda una copia privada en data/backups.
3. Publicar el código compatible.
4. `npm run catalog:salon -- data`: añade solo los artículos faltantes y reclasifica coincidencias. Comprueba dentro de la transacción que ningún saldo, mínimo, conteo pendiente o historial cambió. Es repetible sin duplicar productos.
5. Verificar la publicación y los accesos protegidos.
