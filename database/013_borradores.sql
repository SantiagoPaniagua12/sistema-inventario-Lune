-- Conteos provisionales: nunca se reutiliza conteo_cierre para un turno abierto.
CREATE TABLE IF NOT EXISTS public.borradores_cierre (
  id_turno integer NOT NULL,
  id_producto integer NOT NULL,
  cantidad integer CHECK(cantidad BETWEEN 0 AND 100000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid,
  PRIMARY KEY(id_turno,id_producto),
  FOREIGN KEY(id_turno,id_producto) REFERENCES public.detalle_turno(id_turno,id_producto) ON DELETE CASCADE
);
ALTER TABLE public.borradores_cierre ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.borradores_cierre FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.borradores_cierre FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON public.borradores_cierre TO lune_runtime;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='borradores_cierre' AND policyname='lune_backend') THEN
      CREATE POLICY lune_backend ON public.borradores_cierre FOR ALL TO lune_runtime USING(true) WITH CHECK(true);
    END IF;
  END IF;
END $$;
