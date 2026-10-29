-- Etapa de horneados independiente. No reinterpreta movimientos históricos.
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS solo_cocina boolean NOT NULL DEFAULT false;
ALTER TABLE public.movimiento_inventario ADD COLUMN IF NOT EXISTS fecha_operativa date;
ALTER TABLE public.movimiento_inventario ADD COLUMN IF NOT EXISTS periodo_cocina varchar(10) CHECK(periodo_cocina IN ('Mañana','Tarde'));
ALTER TABLE public.ubicaciones DROP CONSTRAINT IF EXISTS ubicaciones_tipo_check;
ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_tipo_check CHECK(tipo IN ('congelador','mostrador','horneados'));
ALTER TABLE public.movimiento_inventario DROP CONSTRAINT IF EXISTS movimiento_inventario_tipo_check;
ALTER TABLE public.movimiento_inventario ADD CONSTRAINT movimiento_inventario_tipo_check CHECK(tipo IN ('produccion','reposicion','horneado','consumo_cocina','merma','venta_calculada','ajuste','apertura_inicial'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.detalle_turno d JOIN public.productos p USING(id_producto) JOIN public.turnos t USING(id_turno) WHERE t.estado='abierto' AND lower(trim(p.nombre_producto)) IN ('focaccia','pan para tostada','pan para tostadas') AND (d.entrada<>0 OR COALESCE(d.conteo_cierre,0)<>0 OR EXISTS(SELECT 1 FROM public.movimiento_inventario m WHERE m.id_turno=t.id_turno AND m.id_producto=p.id_producto))) THEN
  RAISE EXCEPTION 'Revisar existencias del turno abierto antes de separar los panes de Cocina';
 END IF;
END $$;
UPDATE public.productos SET solo_cocina=true WHERE lower(trim(nombre_producto)) IN ('focaccia','pan para tostada','pan para tostadas') AND NOT solo_cocina;
DO $$ DECLARE target text:=current_schema(); BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lune_runtime') THEN
  EXECUTE format('GRANT INSERT(fecha_operativa,periodo_cocina) ON %I.movimiento_inventario TO lune_runtime',target);
 END IF;
END $$;
