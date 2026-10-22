-- Lune: esquema inicial propuesto para PostgreSQL.
-- Ejecutar en una base vacía. No elimina ni modifica tablas existentes.
-- Si ya creaste tablas, se necesita una migración adaptada a esas tablas.
-- La beta puede usar este esquema con INVENTORY_STORAGE=postgres y db:setup.

BEGIN;

CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre_usuario VARCHAR(80) NOT NULL,
    email VARCHAR(254) UNIQUE,
    password_hash TEXT NOT NULL,
    rol VARCHAR(30) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre_categoria VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE productos (
    id_producto SERIAL PRIMARY KEY,
    id_categoria INTEGER NOT NULL REFERENCES categorias(id_categoria),
    nombre_producto VARCHAR(100) NOT NULL,
    rendimiento INTEGER NOT NULL DEFAULT 1 CHECK (rendimiento > 0),
    stock_minimo INTEGER NOT NULL DEFAULT 1 CHECK (stock_minimo >= 0),
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ubicaciones (
    id_ubicacion SERIAL PRIMARY KEY,
    nombre_ubicacion VARCHAR(50) NOT NULL UNIQUE,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('congelador', 'mostrador'))
);

CREATE TABLE lotes (
    id_lote SERIAL PRIMARY KEY,
    id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
    codigo VARCHAR(40) NOT NULL UNIQUE,
    fecha_produccion DATE NOT NULL,
    -- Campo conservado por compatibilidad. Los lotes nuevos se cuentan por unidades (1).
    rendimiento INTEGER NOT NULL DEFAULT 1 CHECK (rendimiento > 0),
    creado_por INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    observaciones TEXT,
    -- Permite verificar que cada movimiento use un lote del mismo producto.
    UNIQUE (id_lote, id_producto)
);

CREATE TABLE turnos (
    id_turno SERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    periodo VARCHAR(10) NOT NULL CHECK (periodo IN ('manana', 'tarde')),
    id_responsable INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    estado VARCHAR(10) NOT NULL DEFAULT 'abierto'
        CHECK (estado IN ('abierto', 'cerrado')),
    abierto_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cerrado_en TIMESTAMPTZ,
    UNIQUE (fecha, periodo),
    CHECK (
        (estado = 'abierto' AND cerrado_en IS NULL)
        OR (estado = 'cerrado' AND cerrado_en IS NOT NULL)
    ),
    CHECK (cerrado_en IS NULL OR cerrado_en >= abierto_en)
);

-- Para la operación actual: un solo local y un solo turno abierto.
CREATE UNIQUE INDEX un_solo_turno_abierto
    ON turnos (estado) WHERE estado = 'abierto';

CREATE TABLE detalle_turno (
    id_detalle_turno SERIAL PRIMARY KEY,
    id_turno INTEGER NOT NULL REFERENCES turnos(id_turno),
    id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
    entrada INTEGER NOT NULL CHECK (entrada >= 0),
    -- NULL significa pendiente de contar; cero significa que se contó y no quedó nada.
    conteo_cierre INTEGER CHECK (conteo_cierre >= 0),
    UNIQUE (id_turno, id_producto)
);

CREATE TABLE movimiento_inventario (
    id_movimiento_inventario SERIAL PRIMARY KEY,
    id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
    -- Opcional: un conteo o una venta agregada puede no identificar un lote.
    id_lote INTEGER,
    id_ubicacion INTEGER NOT NULL REFERENCES ubicaciones(id_ubicacion),
    -- Opcional: puede haber producción fuera de un turno de mostrador.
    id_turno INTEGER REFERENCES turnos(id_turno),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'produccion', 'reposicion', 'horneado', 'merma',
        'venta_calculada', 'ajuste', 'apertura_inicial'
    )),
    -- Cantidad siempre positiva; sentido determina si suma o resta.
    sentido VARCHAR(7) NOT NULL CHECK (sentido IN ('entrada', 'salida')),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    -- Los movimientos nuevos usan pieza. Las otras etiquetas admiten el historial previo.
    unidad VARCHAR(20) NOT NULL
        CHECK (unidad IN ('unidad_completa', 'porcion', 'pieza')),
    -- Se repite en los movimientos de una misma operación. No es UNIQUE.
    id_operacion UUID NOT NULL,
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    motivo TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_lote, id_producto)
        REFERENCES lotes(id_lote, id_producto)
);

CREATE INDEX movimientos_por_turno
    ON movimiento_inventario (id_turno, id_producto);
CREATE INDEX movimientos_por_stock
    ON movimiento_inventario (id_producto, id_ubicacion, unidad);
CREATE INDEX movimientos_por_lote
    ON movimiento_inventario (id_lote);
CREATE INDEX movimientos_por_operacion
    ON movimiento_inventario (id_operacion);

COMMIT;

-- Reglas que aún debe implementar el servidor, dentro de transacciones:
-- 1. Reposición/horneado: guardar juntos salida congelada y entrada a mostrador.
--    Ambos movimientos comparten un UUID generado una sola vez para la operación.
-- 2. Comprobar y bloquear el stock afectado para impedir consumos concurrentes
--    que produzcan saldos negativos. CHECK(cantidad > 0) no garantiza ese saldo.
-- 3. Al cerrar: exigir todos los conteos, validar venta calculada no negativa,
--    registrar las salidas calculadas y cerrar el turno como una sola operación.
-- 4. Impedir modificaciones de turnos cerrados y validar orden cronológico.
-- 5. Verificar coherencia entre tipo, sentido, ubicación y unidad.
-- 6. Presentar timestamps en America/Lima y usar esa zona para la fecha del turno.
-- 7. No guardar claves en texto plano: generar hashes con una librería de autenticación.
