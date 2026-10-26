-- Amplía categorías y unidades sin alterar existencias.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.insumos'::regclass AND contype='c' LOOP
  IF (c.definition LIKE '%Frutas congeladas%' AND c.definition LIKE '%Bebidas%' AND c.definition LIKE '%ANY%')
   OR (c.definition LIKE '%porcion%' AND c.definition LIKE '%botella%' AND c.definition LIKE '%ANY%') THEN
   EXECUTE format('ALTER TABLE public.insumos DROP CONSTRAINT %I',c.conname);
  END IF;
 END LOOP;
END $$;
ALTER TABLE public.insumos ADD CONSTRAINT insumos_categorias_salon CHECK(categoria IN ('Frutas congeladas','Insumos','Bebidas','Empaques','Preparados líquidos','Limpieza','Cocina','Papelería'));
ALTER TABLE public.insumos ADD CONSTRAINT insumos_unidades_salon CHECK(unidad IN ('porcion','bolsa','caja','botella','unidad','paquete','ml','sobre','rollo'));
