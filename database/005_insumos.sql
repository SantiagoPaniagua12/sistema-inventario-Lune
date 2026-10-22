-- Beta 0.2: módulos independientes del mostrador. NULL significa sin conteo.
CREATE TABLE IF NOT EXISTS insumos (
    id_insumo VARCHAR(100) PRIMARY KEY,
    nombre VARCHAR(180) NOT NULL,
    categoria VARCHAR(30) NOT NULL CHECK (categoria IN ('Frutas congeladas','Insumos','Bebidas','Empaques','Preparados líquidos','Limpieza','Cocina')),
    unidad VARCHAR(12) NOT NULL CHECK (unidad IN ('porcion','bolsa','caja','botella','unidad','paquete','ml')),
    stock INTEGER CHECK (stock BETWEEN 0 AND 1000000000),
    stock_minimo INTEGER CHECK (stock_minimo BETWEEN 0 AND 1000000000),
    capacidad_ml INTEGER CHECK (capacidad_ml > 0),
    unidades_por_paquete INTEGER NOT NULL DEFAULT 1 CHECK (unidades_por_paquete > 0),
    observaciones TEXT NOT NULL DEFAULT '',
    estimado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (categoria,nombre),
    CHECK (categoria <> 'Frutas congeladas' OR unidad='porcion'),
    CHECK (categoria <> 'Preparados líquidos' OR unidad='ml'),
    CHECK (unidad <> 'ml' OR (capacidad_ml IS NOT NULL AND (stock IS NULL OR stock <= capacidad_ml))),
    CHECK (unidades_por_paquete=1 OR categoria='Empaques')
);
CREATE TABLE IF NOT EXISTS movimientos_insumos (
    id_movimiento UUID PRIMARY KEY,
    orden BIGSERIAL UNIQUE NOT NULL,
    id_insumo VARCHAR(100) NOT NULL REFERENCES insumos(id_insumo),
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','salida','conteo')),
    cantidad INTEGER NOT NULL CHECK (cantidad >= 0),
    stock_anterior INTEGER CHECK (stock_anterior >= 0),
    stock_posterior INTEGER NOT NULL CHECK (stock_posterior >= 0),
    responsable VARCHAR(80) NOT NULL,
    motivo TEXT NOT NULL DEFAULT '',
    estimado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (tipo='conteo' OR (cantidad>0 AND stock_anterior IS NOT NULL)),
    CHECK ((tipo='conteo' AND stock_posterior=cantidad)
        OR (tipo='entrada' AND stock_posterior=stock_anterior+cantidad)
        OR (tipo='salida' AND stock_posterior=stock_anterior-cantidad))
);
CREATE INDEX IF NOT EXISTS insumos_por_categoria ON insumos(categoria,nombre);
CREATE INDEX IF NOT EXISTS movimientos_insumos_por_fecha ON movimientos_insumos(id_insumo,creado_en DESC);
