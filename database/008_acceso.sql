-- Ejecutar con el propietario de la base. No modifica existencias ni catálogos.
CREATE TABLE IF NOT EXISTS public.perfiles_acceso (
  auth_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre varchar(80) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  rol text NOT NULL CHECK (rol IN ('admin','cocina','mozo')),
  activo boolean NOT NULL DEFAULT true,
  cambiar_password boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_acceso_nombre ON public.perfiles_acceso(lower(nombre));
CREATE TABLE IF NOT EXISTS public.sesiones_revocadas (
  session_id uuid PRIMARY KEY,
  auth_id uuid NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.limites_acceso (
  clave text PRIMARY KEY,
  intentos integer NOT NULL,
  vence_en timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.auditoria_acceso (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_id uuid,
  accion varchar(80) NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS limites_acceso_vencimiento ON public.limites_acceso(vence_en);
DO $$ DECLARE tabla text; BEGIN
  FOREACH tabla IN ARRAY ARRAY['perfiles_acceso','sesiones_revocadas','limites_acceso','auditoria_acceso'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tabla);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',tabla);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.auditoria_acceso_id_seq FROM anon, authenticated;
