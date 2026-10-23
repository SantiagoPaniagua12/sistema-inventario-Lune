-- Equipos de turno y operaciones repetibles. No modifica cantidades de inventario.
CREATE TABLE IF NOT EXISTS turno_responsables (
  id_turno integer NOT NULL REFERENCES turnos(id_turno),
  id_usuario integer NOT NULL REFERENCES usuarios(id_usuario),
  orden smallint NOT NULL CHECK (orden BETWEEN 1 AND 4),
  incorporado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id_turno,id_usuario),
  UNIQUE(id_turno,orden)
);
INSERT INTO turno_responsables(id_turno,id_usuario,orden,incorporado_en)
SELECT id_turno,id_responsable,1,abierto_en FROM turnos ON CONFLICT DO NOTHING;
ALTER TABLE movimiento_inventario ADD COLUMN IF NOT EXISTS responsables text[];
CREATE TABLE IF NOT EXISTS operaciones_inventario (
  id uuid PRIMARY KEY,
  auth_id uuid,
  tipo varchar(40) NOT NULL,
  contenido_hash varchar(64) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE turno_responsables ENABLE ROW LEVEL SECURITY;
ALTER TABLE operaciones_inventario ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE target text:=current_schema(); tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['turno_responsables','operaciones_inventario'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM anon',target,tbl); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM authenticated',target,tbl); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
      EXECUTE format('GRANT SELECT,INSERT ON TABLE %I.%I TO lune_runtime',target,tbl);
      IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname=target AND tablename=tbl AND policyname='lune_backend') THEN
        EXECUTE format('CREATE POLICY lune_backend ON %I.%I FOR ALL TO lune_runtime USING(true) WITH CHECK(true)',target,tbl);
      END IF;
    END IF;
  END LOOP;
END $$;
