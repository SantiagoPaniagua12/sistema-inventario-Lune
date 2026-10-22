# Lune · Requisitos consolidados

Actualizado: 22 de octubre de 2026.

Este documento registra las indicaciones del usuario y del gerente. No significa que las funciones pendientes ya estén implementadas. El 22 de octubre de 2026 el usuario autorizó mantener el puerto 3000 activo hasta que pida cerrarlo o cierre la aplicación. Esta indicación sustituye la instrucción anterior de mantenerlo cerrado.

## Avance en la beta 0.2

Implementados en el código: frutas por porciones, 38 insumos y bebidas confirmados, entradas de empaques por millar, preparados líquidos por ml o porcentaje estimado, catálogo independiente de limpieza, ampliación de cocina, dashboards por turno y PDF de reposición. El mínimo de cada insumo puede definirse y el reporte permite elegir si incluye igualdad al mínimo. Los conteos iniciales pendientes no se tratan como agotados.

La migración a Supabase se completó el 22 de octubre de 2026. Se verificaron todos los campos de las 12 tablas, los permisos y la lectura de la aplicación. Se conservaron PostgreSQL local y un respaldo previo en `data/migrations`. La aplicación usa `INVENTORY_STORAGE=supabase`; el puerto 3000 está activo y los registros están habilitados. No se ha publicado. Ver `docs/supabase-beta-02.md` para los pasos y límites.

Por instrucción del usuario, el 22 de octubre se eliminaron de Supabase los registros ficticios de producción, turnos y movimientos. Se conservaron íntegros los 20 productos, los 38 insumos, mínimos, usuarios, categorías y ubicaciones. Los insumos quedaron sin conteo (NULL), no con ceros inventados. El respaldo previo está en `data/resets`; la copia local anterior permanece como archivo de prueba, no como base activa sincronizada. El siguiente inicio debe registrar existencias reales de Lune. No se ha publicado la aplicación; siguen pendientes el inicio de sesión y los permisos por usuario antes de habilitarla en Internet.

## Alertas e historial de Excel

Implementados: cuadro independiente de productos por acabarse en todas las áreas, avisos dentro de la aplicación abierta, mínimos opcionales de reserva congelada, lectura de Excel `.xlsx` con vista previa, asociación manual de nombres no reconocidos y validación de duplicados y cantidades. La foto del usuario muestra bloques de cuatro filas (entrada, ingreso nuevo, salida turno y ventas), fechas hacia la derecha y secciones de mañana/tarde; el lector contempla esa disposición.

El historial de postres alimenta Historial y Ventas por turno. El de reserva guarda moldes de entrada, producidos y usados por turno y saldo resultante; no se interpreta como ventas ni como stock nuevo. Ambos conservan archivo, hoja y fila de procedencia. Se recomienda conservar los datos antiguos y hacer un conteo físico para iniciar el stock actual. Pendiente contrastar el lector con los archivos originales `.xlsx`; se ha probado con archivos de ensayo que reproducen los bloques de la foto. Ver `docs/alertas-e-importacion-excel.md`.

## Base existente que se conserva

- Postres, croissants y rolls se cuentan por unidades, sin conversión a porciones.
- Producción congelada y mostrador tienen existencias separadas; retirar una unidad suma una unidad al mostrador.
- Dos turnos: mañana y tarde. Cada apertura recibe el conteo del cierre anterior.
- Venta calculada del turno: entrada + ingresos − stock al cierre. Los ajustes históricos previos conservan sus cantidades.
- No se registran nuevos descartes. Las unidades pagadas por trabajadores se incluyen en la venta calculada.
- Responsables de cocina y mostrador separados. La producción no copia el nombre del responsable del turno.
- Mínimo actual del mostrador: 1 unidad por producto. Los mínimos de los nuevos insumos deben definirse por producto.
- La sección Productos no muestra imágenes.

## Frutas congeladas

El control confirmado es únicamente por **cantidad de porciones**, sin registrar pesos ni convertir a gramos o kilogramos. Esta unidad corresponde a las frutas y no cambia el conteo por unidades de los postres.

Variedades:

- Frutos rojos.
- Mango.
- Piña.
- Papaya norteña.
- Papaya arequipeña.
- Fresa, añadida en la última actualización.

Aunque el personal pese las frutas durante su preparación, el sistema solo registrará cuántas porciones de cada variedad ingresan, se retiran y quedan disponibles. No hace falta confirmar pesos ni registrar el contenido en gramos de las bolsas.

## Insumos y empaques

| Producto | Control confirmado |
| --- | --- |
| Café | Bolsas disponibles. |
| Azúcar | Bolsas disponibles. Nueva incorporación. |
| Estevia | Bolsas disponibles. Nueva incorporación. |
| Matcha | Bolsas disponibles. |
| Hielo | Bolsas disponibles. |
| Flores comestibles | Cajas disponibles. |
| Fruta deshidratada: manzana | Bolsas disponibles, por separado. |
| Fruta deshidratada: naranja | Bolsas disponibles, por separado. |
| Fruta deshidratada: piña | Bolsas disponibles, por separado. |
| Fruta deshidratada: fresa | Bolsas disponibles, por separado. |
| Cajas pequeñas de empaque | Unidades disponibles; cada millar recibido agrega 1.000 cajas pequeñas. |
| Cajas grandes de empaque | Unidades disponibles; cada millar recibido agrega 1.000 cajas grandes. |

Los dos tamaños de empaque tienen inventarios independientes. Los retiros descuentan unidades del saldo correspondiente, no un millar completo. Ejemplo: ingresar un millar de cajas pequeñas y retirar 35 deja 965 cajas pequeñas. No se ha confirmado si el retiro se registrará manualmente o se asociará a otro movimiento; no asumir descuento automático por venta.

Las frutas deshidratadas se usan para decorar jugos y frappés. No agrupar sus cuatro variedades en un solo stock.

### Infusiones

Registrar cada variedad por separado:

- Bella Durmiente.
- Herbalito de eucalipto.
- Taza de Amor.
- Bombón como tú.
- Kuyay.
- Qori.

Se describieron como bolsas de infusiones. Falta confirmar si son bolsas de mezcla a granel o presentaciones con sobres individuales y el nivel de detalle que necesitan descontar.

## Leches y bebidas envasadas

| Producto | Presentación confirmada |
| --- | --- |
| Leche entera | Bolsa de 1.125 ml, equivalente a 1,125 litros. |
| Leche deslactosada | Bolsa de 1.125 ml, equivalente a 1,125 litros. |
| Agua con gas | Botella de vidrio de 355 ml. Reemplaza la referencia anterior de 300 ml. |
| Agua sin gas | Botella de vidrio de 355 ml. Reemplaza la referencia anterior de 300 ml. |
| Kombucha Chill Out | Botella de vidrio de 355 ml. |
| Kombucha Sunset Fizz | Botella de vidrio de 355 ml. |
| Kombucha Emoliente | Botella de vidrio de 355 ml. |
| Kola Escocesa | Botella de plástico de 500 ml. |

Contar las bolsas o botellas de cada variante por separado. La capacidad del envase no debe confundirse con la cantidad de envases disponibles.

## Preparados líquidos

| Preparado | Capacidad del recipiente |
| --- | ---: |
| Maracuyá | 600 ml |
| Toffe | 600 ml |
| Extracto de tumbo | 600 ml |
| Jarabe de goma | 600 ml |
| Almíbar de muña | 600 ml |
| Leche condensada | 200 ml |

Propuesta de control todavía por concretar: registrar mililitros restantes y mostrar su equivalente porcentual. Distinguir mediciones de estimaciones. Falta confirmar cómo miden el contenido y cómo registrarán consumos y recargas. No descontar una receta automáticamente sin definir sus cantidades.

## Productos de limpieza

Se aprobó incluirlos en una sección separada de alimentos y bebidas.

- Registrar entradas, retiros para uso y mínimos de reposición.
- Priorizar el conteo por botellas, bidones, bolsas, paquetes o unidades según la presentación.
- No exigir medir cada pequeña cantidad utilizada de un producto de limpieza.
- Falta el catálogo y las presentaciones concretas.

## Insumos de cocina: ampliación futura

Prever un catálogo de aproximadamente **200 a 240 insumos de cocina**. Aún no se ha entregado la lista.

La estructura debe admitir categorías, búsqueda, unidad de medida y mínimo por producto. No crear insumos ficticios ni exigir completar ahora ese catálogo. No se ha confirmado el descuento automático por recetas.

## Dashboard por turno

Requisito acordado para facilitar el trabajo del mostrador:

- Mostrar el total de unidades vendidas calculadas en cada turno.
- Mostrar cuáles productos se vendieron y cuántas unidades de cada uno.
- Facilitar la consulta de mañana, tarde y turnos anteriores.
- Mostrar un resultado provisional solo para los productos ya contados, con indicación de cuántos faltan por contar; no interpretar un conteo vacío como cero.
- Al cerrar, guardar el resumen completo.
- Hasta integrar la caja, identificar los datos como venta calculada, no como ventas verificadas.
- Los sabores que comparten la base de croissant clásico no pueden deducirse del conteo físico de esa base.

## PDF de insumos con pocas existencias

Nuevo requisito: poder descargar un **PDF con los insumos que queden pocos**, según el mínimo configurado para cada producto.

Contenido propuesto del reporte:

- Fecha y hora de generación.
- Categoría, nombre del insumo y unidad de medida.
- Existencia disponible y mínimo configurado.
- Identificación de los productos agotados.

Falta acordar los mínimos de los insumos y si la condición de inclusión será menor al mínimo o menor o igual. No calcular cantidades de compra sin definir un stock objetivo o una regla de reposición.

## Publicación e integración: pendientes

- Completar los cambios acordados con el gerente y las cuentas del personal antes de la prueba privada con Lune.
- Propuesta de publicación: Next.js en Netlify; PostgreSQL y autenticación en Supabase. La migración y publicación todavía no se han realizado.
- Sistema de ventas indicado: Bite Solutions, https://lune.si-cdperu.com/tabletSystem.
- No se ha confirmado disponibilidad de API, webhooks ni exportación. Consultar al proveedor antes de implementar la integración con n8n.
- Si se incorporan ventas externas, mantenerlas separadas de las calculadas por conteo y evitar descontar ambas veces la misma salida.
