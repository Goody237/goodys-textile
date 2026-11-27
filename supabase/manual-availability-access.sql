BEGIN;

DO $$
BEGIN
  IF to_regclass('public.catalogue_availability') IS NOT NULL THEN
    RAISE EXCEPTION 'public.catalogue_availability already exists; inspect it before changing its definition or grants.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = 'products'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'public.products must have row-level security enabled.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd IN ('INSERT', 'ALL')
      AND COALESCE(qual, '') || COALESCE(with_check, '') ILIKE '%is_admin%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd IN ('UPDATE', 'ALL')
      AND COALESCE(qual, '') || COALESCE(with_check, '') ILIKE '%is_admin%'
  ) THEN
    RAISE EXCEPTION 'Existing admin-only INSERT and UPDATE policies using is_admin() must be verified before applying these grants.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) NOT ILIKE '%is_admin%'
  ) THEN
    RAISE EXCEPTION 'A products write policy does not reference is_admin(); inspect all INSERT and UPDATE policies before applying these grants.';
  END IF;
END
$$;

CREATE VIEW public.catalogue_availability
WITH (security_barrier = true)
AS
SELECT
  id,
  sku,
  title,
  category,
  description,
  image_url,
  gallery,
  featured,
  selling_unit,
  price,
  minimum_quantity,
  quantity_step,
  stock_status
FROM public.products
WHERE is_published IS TRUE;

REVOKE ALL PRIVILEGES ON TABLE public.catalogue_availability FROM PUBLIC;
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

GRANT SELECT, INSERT, UPDATE ON TABLE public.products TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
