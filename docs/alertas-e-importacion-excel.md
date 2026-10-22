# Alertas e importación de Excel

## Cuadro general y avisos

La sección **Alertas de inventario** reúne mostrador, reserva congelada, frutas, insumos, bebidas, empaques, preparados líquidos, cocina y limpieza. Incluye saldos agotados y cantidades iguales o inferiores al mínimo. No suma cantidades de unidades diferentes.

El aviso superior está disponible en todas las pantallas. Cambia cuando aparece un producto bajo o se reduce otra vez su saldo. Son notificaciones dentro de la aplicación: requieren mantenerla abierta. No se envían correos, WhatsApp ni notificaciones con la aplicación cerrada.

Los datos se consultan cada 30 segundos con la página visible. Se pausa la actualización durante una operación o un formulario modal. Los saldos sin conteo no se consideran cero. En mostrador se usa el último cierre o el disponible del turno abierto; este último todavía no descuenta ventas y se marca como estimado.

Configura el mínimo del congelador en **Productos > Editar > Mínimo en reserva congelada**. No se asigna un mínimo arbitrario. Una reserva sin ningún lote se señala como pendiente de registro inicial, no como agotada. Cuando ya hubo producción, un saldo de cero sí genera alerta.

## Conservar el historial

Conviene importar los datos antiguos completos y comenzar la operación actual con un conteo físico. El historial del Excel se guarda por separado para no duplicar existencias actuales, modificar cierres existentes ni simular producción pasada como stock nuevo.

La importación es solo para los productos de la categoría **Postres**. Los croissants y rolls de los archivos se deben omitir explícitamente.

1. Abre **Importar Excel**, selecciona un archivo `.xlsx` y escribe quién realiza la importación.
2. Elige la hoja y el contenido: mostrador o reserva. Se importa una hoja a la vez.
3. Para el formato de la foto, elige **Bloques por producto y fechas a la derecha (Lune)**. Lee nombres en la primera columna, etiquetas y valores en columnas contiguas, fechas horizontales y encabezados de mañana/tarde. Reconoce fechas de Excel, `dd/mm/aaaa` y fechas como `jueves, 15 de octubre de 2026`.
   El rango de importación termina hoy por defecto; las casillas futuras de las plantillas mensuales quedan fuera y se informa cuántos registros se excluyeron. Ajusta el rango a las fechas realmente trabajadas.
4. Si el archivo es una tabla, elige **Una fila por producto** y asocia sus columnas. Los movimientos cero deben estar escritos o elegirse explícitamente como cero.
5. Revisa las asociaciones al catálogo, las cantidades, fechas, turnos e incidencias. Los nombres se normalizan por tildes y mayúsculas; otros nombres requieren selección manual. Omitir un producto excluye todos sus registros de esa hoja y se informa en el resumen.
6. Confirma la importación. El botón se habilita solo cuando todos los registros incluidos son válidos. No se guarda nada al subir el archivo ni se reemplazan registros existentes.

### Mostrador

Se guardan fecha, turno, producto, entrada, ingreso nuevo y salida de turno. Las ventas se calculan como `entrada + ingreso nuevo − salida de turno`; si el Excel tiene ventas, se comprueba que coincidan. Los datos se consultan en **Historial**, **Ventas por turno** y **Historial importado**.

### Reserva congelada

Se guardan fecha, turno, postre, moldes de entrada, moldes producidos, moldes usados y saldo. Se comprueba `entrada + producción − usados = saldo`. Si falta la columna de saldo, se calcula a partir de los tres movimientos. Los moldes usados no se interpretan como ventas. Se consulta en **Historial importado > Reserva congelada**; no se convierten automáticamente a unidades de mostrador.

### Validaciones y límites

- No se aceptan fechas futuras, cantidades negativas, fracciones, cierres mayores al disponible, productos fuera del catálogo ni duplicados de producto/fecha/turno/sección. Tampoco se solapan archivos con turnos operativos ya registrados.
- Las celdas vacías no son cero. Las fórmulas deben tener un resultado guardado por Excel; el importador no ejecuta ni recalcula fórmulas. Abre, recalcula y guarda el archivo si falta el resultado.
- Archivos `.xlsx` de hasta 5 MB, 24 hojas visibles, 5000 filas y 100 columnas por hoja; hasta 3000 registros por confirmación. Se valida y limita la expansión del archivo comprimido. La vista previa y el historial tienen páginas de 50 registros; se pueden recorrer todos. El historial permite filtrar por sección, postre y fechas. El respaldo contiene todos los registros.
- Los formatos `.xls` deben guardarse como `.xlsx`. No se importan archivos protegidos, macros ni imágenes. La foto orienta el lector; la compatibilidad con los documentos originales debe comprobarse al recibirlos.

## Base de datos y Supabase

Ejecutar `npm run db:features` una vez para agregar la columna opcional `productos.stock_minimo_reserva` y la tabla `importaciones_excel`. La operación conserva los datos anteriores. `npm run db:beta2` también prepara estos cambios en una instalación nueva.

La migración a Supabase ya incluye la tabla del historial y su protección de acceso. La aplicación usa la conexión privada con certificado TLS verificado. No se ha publicado la aplicación ni incorporado autenticación en esta beta.
