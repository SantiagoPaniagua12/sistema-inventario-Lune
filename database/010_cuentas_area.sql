-- Dos cuentas operativas: Cocina y Salón. Administración se conserva aparte.
-- Si hubiera perfiles personales, detener y revisarlos; no se borran ni reclasifican.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.perfiles_acceso WHERE (rol='cocina' AND nombre<>'Cocina') OR (rol='mozo' AND nombre<>'Salón')) THEN
    RAISE EXCEPTION 'Existen perfiles personales. Revisar antes de activar las cuentas de área.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.perfiles_acceso'::regclass AND conname='perfiles_cuentas_area') THEN
    ALTER TABLE public.perfiles_acceso ADD CONSTRAINT perfiles_cuentas_area CHECK(rol='admin' OR (rol='cocina' AND nombre='Cocina') OR (rol='mozo' AND nombre='Salón'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_unica_cuenta_area ON public.perfiles_acceso(rol) WHERE rol IN ('cocina','mozo');
