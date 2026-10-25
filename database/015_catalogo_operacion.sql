-- Preparación aditiva; no cambia existencias ni renombra categorías.
ALTER TABLE public.insumos ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.insumos ADD COLUMN IF NOT EXISTS fusionado_en varchar(100);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.insumos'::regclass AND contype='c' LOOP
  IF c.definition LIKE '%unidades_por_paquete%' OR (c.definition LIKE '%porcion%' AND c.definition LIKE '%unidad%' AND c.definition LIKE '%ANY%') THEN
   EXECUTE format('ALTER TABLE public.insumos DROP CONSTRAINT %I',c.conname);
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.insumos'::regclass AND conname='insumos_fusion_fk') THEN
  ALTER TABLE public.insumos ADD CONSTRAINT insumos_fusion_fk FOREIGN KEY(fusionado_en) REFERENCES public.insumos(id_insumo) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
ALTER TABLE public.insumos ADD CONSTRAINT insumos_unidad_catalogo CHECK(unidad IN ('porcion','bolsa','caja','botella','unidad','paquete','ml','sobre'));
ALTER TABLE public.insumos ADD CONSTRAINT insumos_presentacion_catalogo CHECK(unidades_por_paquete>0 AND (unidades_por_paquete=1 OR categoria='Empaques' OR (categoria='Insumos' AND unidad='sobre')));

CREATE OR REPLACE FUNCTION public.eliminar_producto_sin_historial(producto integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(20261018,5433);
 PERFORM 1 FROM public.productos WHERE id_producto=producto FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El producto no existe.'; END IF;
 IF EXISTS(SELECT 1 FROM public.lotes WHERE id_producto=producto) OR EXISTS(SELECT 1 FROM public.movimiento_inventario WHERE id_producto=producto)
 OR EXISTS(SELECT 1 FROM public.detalle_turno d JOIN public.turnos t USING(id_turno) WHERE d.id_producto=producto AND (t.estado='cerrado' OR d.entrada<>0 OR COALESCE(d.conteo_cierre,0)<>0))
 OR EXISTS(SELECT 1 FROM public.borradores_cierre WHERE id_producto=producto AND COALESCE(cantidad,0)<>0)
 OR EXISTS(SELECT 1 FROM public.importaciones_excel i, jsonb_array_elements(i.registros) r WHERE r->>'productId'=producto::text)
 THEN RAISE EXCEPTION 'Tiene existencias o historial. Desactiva el producto para conservar sus registros.'; END IF;
 DELETE FROM public.borradores_cierre WHERE id_producto=producto;
 DELETE FROM public.detalle_turno WHERE id_producto=producto;
 DELETE FROM public.productos WHERE id_producto=producto;
END $$;
CREATE OR REPLACE FUNCTION public.eliminar_insumo_sin_historial(insumo text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(20261018,5433);
 PERFORM 1 FROM public.insumos WHERE id_insumo=insumo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El insumo no existe.'; END IF;
 IF EXISTS(SELECT 1 FROM public.insumos WHERE (id_insumo=insumo AND (COALESCE(stock,0)<>0 OR fusionado_en IS NOT NULL)) OR fusionado_en=insumo)
 OR EXISTS(SELECT 1 FROM public.movimientos_insumos WHERE id_insumo=insumo)
 THEN RAISE EXCEPTION 'Tiene existencias, historial o una unificación. Desactiva el producto.'; END IF;
 DELETE FROM public.insumos WHERE id_insumo=insumo;
END $$;
REVOKE ALL ON FUNCTION public.eliminar_producto_sin_historial(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_insumo_sin_historial(text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.eliminar_producto_sin_historial(integer) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.eliminar_insumo_sin_historial(text) FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.eliminar_producto_sin_historial(integer) TO lune_runtime;
  GRANT EXECUTE ON FUNCTION public.eliminar_insumo_sin_historial(text) TO lune_runtime;
 END IF;
END $$;
