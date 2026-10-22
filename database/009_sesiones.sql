-- Revocación inmediata en la aplicación, sin esperar a que caduque el JWT.
ALTER TABLE public.perfiles_acceso ADD COLUMN IF NOT EXISTS version_acceso integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS public.sesiones_aplicacion (
  session_id uuid PRIMARY KEY,
  auth_id uuid NOT NULL REFERENCES public.perfiles_acceso(auth_id) ON DELETE CASCADE,
  version_acceso integer NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sesiones_aplicacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sesiones_aplicacion FROM anon, authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON public.sesiones_aplicacion TO lune_runtime;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sesiones_aplicacion' AND policyname='lune_backend') THEN
      CREATE POLICY lune_backend ON public.sesiones_aplicacion FOR ALL TO lune_runtime USING(true) WITH CHECK(true);
    END IF;
  END IF;
END $$;
