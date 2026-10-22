-- Metadato técnico de concurrencia de la aplicación; conserva las ocho tablas.
CREATE TABLE IF NOT EXISTS inventario_control (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO inventario_control (id, revision) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
