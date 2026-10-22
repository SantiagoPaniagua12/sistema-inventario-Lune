-- Se cambia el catálogo a conteo por unidades, sin multiplicación.
-- Los lotes y movimientos anteriores conservan íntegramente sus cantidades.
WITH actualizados AS (
    UPDATE productos SET rendimiento = 1 WHERE rendimiento <> 1
    RETURNING id_producto
)
UPDATE inventario_control SET revision = revision + 1
WHERE id = 1 AND EXISTS (SELECT 1 FROM actualizados);
