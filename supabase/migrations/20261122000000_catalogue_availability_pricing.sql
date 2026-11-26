BEGIN;

CREATE OR REPLACE VIEW public.catalogue_availability
WITH (security_barrier = true)
AS
SELECT id, stock_status, price, selling_unit, minimum_quantity
FROM public.products
WHERE is_published IS TRUE;

REVOKE ALL PRIVILEGES ON TABLE public.catalogue_availability FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.catalogue_availability TO anon;

REVOKE ALL PRIVILEGES ON TABLE public.products FROM anon, PUBLIC;

DO $$
DECLARE
  product_column text;
BEGIN
  FOR product_column IN
    SELECT a.attname
    FROM pg_attribute AS a
    WHERE a.attrelid = 'public.products'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), REFERENCES (%1$I) ON TABLE public.products FROM anon, PUBLIC',
      product_column
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
