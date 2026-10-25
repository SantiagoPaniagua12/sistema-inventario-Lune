# Actualización de catálogo y conteos · octubre 2026

- «Salida» significa las unidades que quedan al finalizar el turno. Se escribe manualmente; la rueda y las flechas no alteran el valor. Entrada + ingresos − salida = venta calculada.
- Sin reserva no se admiten ingresos al mostrador. La salida se bloquea y muestra cero solamente si tampoco hay unidades disponibles en el mostrador. Ese cero provisional no se guarda como un conteo del nuevo ingreso si posteriormente se repone.
- Las ventas diarias reúnen postres y bollería en una tabla con filtro por categoría.
- Administración puede desactivar, reactivar y eliminar productos desde el catálogo y los insumos. Solo se elimina un producto sin movimientos ni cierres históricos. Los desactivados conservan sus registros y las existencias pendientes de consumo/conteo. «Mostrar desactivados» permite consultarlos.
- Kombuchas reúne las botellas de 355 ml. Se archivan los sabores conservando su historial. Sin conteos completos se solicita un conteo real y no se supone stock cero.
- Azúcar: bolsa de 500 sobres de 5 g. Estevia: bolsa de 100 sobres de 1 g. Los saldos anteriores ya representan sobres y no se multiplican. Los ingresos nuevos admiten sobres individuales o bolsas; el consumo se descuenta por sobres.
- Es posible seguir añadiendo productos desde administración después de esta actualización.

## Despliegue con datos existentes

1. Ejecutar pruebas y compilación.
2. `npm run catalog:update -- schema` prepara campos, restricciones y funciones limitadas sin alterar existencias. Genera copia privada en `data/backups` (excluida de Git).
3. Publicar código compatible con las categorías anteriores y nuevas.
4. Una vez disponible el despliegue, `npm run catalog:update -- data` actualiza presentaciones y unifica las kombuchas dentro de una transacción con el mismo bloqueo de las operaciones de inventario. Conserva las cantidades de azúcar/estevia. Es repetible sin duplicar movimientos de unificación.
5. Comprobar inventario, permisos y acceso protegido en producción. No usar las existencias reales como datos de prueba.

Las funciones de eliminación rechazan productos con historial y solo permiten ejecución al rol del servidor. Se mantiene bloqueado el borrado directo de productos y el acceso anónimo/autenticado a las tablas.
