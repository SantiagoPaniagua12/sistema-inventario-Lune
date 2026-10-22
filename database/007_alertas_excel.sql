ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_minimo_reserva INTEGER CHECK (stock_minimo_reserva BETWEEN 0 AND 100000);
CREATE TABLE IF NOT EXISTS importaciones_excel (
  id_importacion UUID PRIMARY KEY,
  archivo VARCHAR(180) NOT NULL,
  importado_por VARCHAR(80) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL,
  registros JSONB NOT NULL CHECK (jsonb_typeof(registros)='array' AND jsonb_array_length(registros) BETWEEN 1 AND 3000)
);
-- Los registros son archivo histórico; no afectan lotes, saldos ni movimientos actuales.
