-- Solo en el proyecto Supabase de destino. Esta beta accede desde Next.js con
-- conexión privada del servidor. El acceso anónimo y Data API quedan sin permisos.
-- No ofrece todavía inicio de sesión; no publicar el backend sin autenticación.
DO $$
DECLARE tabla TEXT;
BEGIN
    FOREACH tabla IN ARRAY ARRAY['usuarios','categorias','productos','ubicaciones','lotes','turnos','detalle_turno','movimiento_inventario','inventario_control','insumos','movimientos_insumos','importaciones_excel']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tabla);
    END LOOP;
END $$;
