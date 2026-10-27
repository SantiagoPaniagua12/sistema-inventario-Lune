-- Actualizar el integrante de un puesto, conservando el orden y sin permiso de borrado.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
  GRANT UPDATE(id_usuario,incorporado_en) ON TABLE public.turno_responsables TO lune_runtime;
 END IF;
END $$;
