# Infusiones por fracciones de bolsa

Las seis infusiones del catálogo (Bella Durmiente, Herbalito de eucalipto, Taza de Amor, Bombón como tú, Kuyay y Qori) admiten hasta dos decimales mientras su unidad sea bolsa y pertenezcan a Insumos. La regla usa sus identificadores de catálogo, por lo que cambiar el nombre no altera el control. Las nuevas altas conservan el control por enteros.

En Insumos, Conteo establece el disponible, Ingresar suma y Retirar resta. Se admiten cantidades como 0.50 o 0,50; el movimiento positivo mínimo es 0.01. El mínimo de reposición se configura desde Editar y puede ser 0.25. Un conteo o mínimo de cero es válido; vacío en el mínimo significa sin definir. El saldo y el historial se calculan en centésimas para evitar residuos de redondeo. Las alertas respetan los valores fraccionados.

Las fracciones pueden representar estimaciones físicas. No se calcula el rendimiento en tazas ni se descuenta automáticamente por receta. Esta actualización no carga existencias ni mínimos iniciales.

## Preparación de la base existente

```sh
npm run db:infusions
npm run db:infusions -- --apply
```

El primer comando inspecciona sin modificar la base seleccionada en la configuración local. El segundo aplica `database/018_infusiones_decimales.sql` en una transacción, con el bloqueo de escrituras del inventario y una copia privada previa en `data/backups`. Verifica que todos los registros y cantidades permanezcan iguales antes de confirmar. En Supabase usa la conexión administrativa local; no cambia los permisos de la cuenta de ejecución.

La migración es repetible. Amplía las cinco columnas de cantidades y mínimos a NUMERIC y conserva las restricciones de no negatividad, precisión y movimientos. El adaptador convierte los números de PostgreSQL a valores numéricos del estado; los respaldos de enteros siguen siendo válidos. En producción, publicar primero esta versión compatible con columnas enteras y NUMERIC; a continuación aplicar la migración y comprobar `prepared: true` antes de registrar fracciones. No ampliar las columnas mientras siga activa la versión anterior: su adaptador no convierte los NUMERIC devueltos como texto. Para instalaciones nuevas, `db:beta2` incorpora también esta preparación.
