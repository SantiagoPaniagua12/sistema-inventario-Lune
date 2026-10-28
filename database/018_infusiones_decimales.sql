-- Bolsas de las seis infusiones existentes: hasta dos decimales.
-- NUMERIC sin escala fija rechaza excesos mediante CHECK, en vez de redondearlos.
-- Ejecutar dentro de una transacción. No cambia cantidades, nombres ni historial.
ALTER TABLE public.insumos
    ALTER COLUMN stock TYPE NUMERIC USING stock::numeric,
    ALTER COLUMN stock_minimo TYPE NUMERIC USING stock_minimo::numeric;
ALTER TABLE public.movimientos_insumos
    ALTER COLUMN cantidad TYPE NUMERIC USING cantidad::numeric,
    ALTER COLUMN stock_anterior TYPE NUMERIC USING stock_anterior::numeric,
    ALTER COLUMN stock_posterior TYPE NUMERIC USING stock_posterior::numeric;

ALTER TABLE public.insumos DROP CONSTRAINT IF EXISTS insumos_stock_precision;
ALTER TABLE public.insumos ADD CONSTRAINT insumos_stock_precision CHECK (
    stock = round(stock, CASE
        WHEN id_insumo IN ('infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5')
            AND categoria='Insumos' AND unidad='bolsa' THEN 2 ELSE 0 END)
);
ALTER TABLE public.insumos DROP CONSTRAINT IF EXISTS insumos_stock_minimo_precision;
ALTER TABLE public.insumos ADD CONSTRAINT insumos_stock_minimo_precision CHECK (
    stock_minimo = round(stock_minimo, CASE
        WHEN id_insumo IN ('infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5')
            AND categoria='Insumos' AND unidad='bolsa' THEN 2 ELSE 0 END)
);
ALTER TABLE public.movimientos_insumos DROP CONSTRAINT IF EXISTS movimientos_insumos_precision;
ALTER TABLE public.movimientos_insumos ADD CONSTRAINT movimientos_insumos_precision CHECK (
    cantidad NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    AND stock_anterior NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    AND stock_posterior NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    AND cantidad = round(cantidad, CASE
        WHEN id_insumo IN ('infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5') THEN 2 ELSE 0 END)
    AND stock_anterior = round(stock_anterior, CASE
        WHEN id_insumo IN ('infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5') THEN 2 ELSE 0 END)
    AND stock_posterior = round(stock_posterior, CASE
        WHEN id_insumo IN ('infusion-0','infusion-1','infusion-2','infusion-3','infusion-4','infusion-5') THEN 2 ELSE 0 END)
);
