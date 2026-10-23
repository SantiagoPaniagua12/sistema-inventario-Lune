-- La copia y el cierre se confirman juntos. Storage se procesa después del COMMIT.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('SELECT','ALL') AND roles && ARRAY['public','anon','authenticated']::name[]) THEN
    RAISE EXCEPTION 'Revisar las politicas de lectura de Storage antes de activar respaldos';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.respaldos_turno (
  id uuid PRIMARY KEY,
  id_turno integer NOT NULL REFERENCES public.turnos(id_turno),
  revision integer NOT NULL UNIQUE,
  fecha date NOT NULL,
  periodo text NOT NULL CHECK(periodo IN ('manana','tarde')),
  motivo text NOT NULL CHECK(motivo IN ('cierre','correccion')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  contenido jsonb,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  archivo text NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','guardado')),
  intentos integer NOT NULL DEFAULT 0,
  reintentar_en timestamptz NOT NULL DEFAULT now(),
  bloqueo uuid,
  bloqueado_hasta timestamptz,
  ultimo_error text,
  guardado_en timestamptz,
  bytes integer,
  CHECK((estado='guardado') = (guardado_en IS NOT NULL)),
  CHECK(estado='guardado' OR contenido IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS respaldos_turno_pendientes ON public.respaldos_turno(reintentar_en) WHERE estado='pendiente';
ALTER TABLE public.respaldos_turno ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.respaldos_turno FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.respaldos_turno FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.respaldos_turno FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON public.respaldos_turno TO lune_runtime;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='respaldos_turno' AND policyname='lune_backend') THEN
      CREATE POLICY lune_backend ON public.respaldos_turno FOR ALL TO lune_runtime USING(true) WITH CHECK(true);
    END IF;
  END IF;
END $$;
