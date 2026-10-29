-- Optional metadata: existing supply balances and history remain unchanged.
ALTER TABLE public.movimientos_insumos ADD COLUMN IF NOT EXISTS id_turno integer REFERENCES public.turnos(id_turno);
ALTER TABLE public.movimientos_insumos ADD COLUMN IF NOT EXISTS retiro_fruta_id uuid REFERENCES public.movimientos_insumos(id_movimiento) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS movimientos_insumos_turno_fruta ON public.movimientos_insumos(id_turno,retiro_fruta_id) WHERE retiro_fruta_id IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.movimientos_insumos'::regclass AND conname='retiro_fruta_metadatos') THEN
  ALTER TABLE public.movimientos_insumos ADD CONSTRAINT retiro_fruta_metadatos CHECK((id_turno IS NULL)=(retiro_fruta_id IS NULL) AND (retiro_fruta_id IS NULL OR tipo IN ('entrada','salida')));
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
  GRANT INSERT(id_turno,retiro_fruta_id) ON public.movimientos_insumos TO lune_runtime;
 END IF;
END $$;
