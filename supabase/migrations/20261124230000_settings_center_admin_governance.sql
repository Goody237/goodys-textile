BEGIN;

DO $$
DECLARE
  v_required_table text;
  v_catalogue_columns text[];
  v_catalogue_options text[];
  v_catalogue_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid
      AND lower(email) = 'goodystextile@gmail.com'
      AND email_confirmed_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = 'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
      AND lower(email) = 'tamuforgoodness@gmail.com'
      AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Both verified Main Administrator Auth identities must match the approved UUID/email pairs.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_language AS l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'is_admin'
      AND p.pronargs = 0
      AND p.prorettype = 'boolean'::regtype
      AND p.prosecdef
      AND l.lanname = 'sql'
  ) THEN
    RAISE EXCEPTION 'Expected public.is_admin() SECURITY DEFINER boolean function was not found; inspect the live function before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Expected public.admin_users(user_id uuid) was not found.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_users'
      AND column_name = 'created_at'
      AND is_nullable = 'NO'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'public.admin_users.created_at must be nullable or have a default for administrator assignment.';
  END IF;

  IF to_regclass('public.catalogue_availability') IS NULL THEN
    RAISE EXCEPTION 'Expected public.catalogue_availability view was not found.';
  END IF;
  SELECT array_agg(c.column_name ORDER BY c.ordinal_position)
  INTO v_catalogue_columns
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'catalogue_availability';
  IF v_catalogue_columns IS DISTINCT FROM ARRAY[
    'id',
    'stock_status',
    'price',
    'selling_unit',
    'minimum_quantity',
    'sku',
    'title',
    'category',
    'description',
    'image_url',
    'gallery',
    'featured',
    'quantity_step'
  ]::text[] THEN
    RAISE EXCEPTION 'public.catalogue_availability does not match the reviewed 13-column contract; inspect it before applying this migration.';
  END IF;

  SELECT c.reloptions, pg_get_viewdef(c.oid, true)
  INTO v_catalogue_options, v_catalogue_definition
  FROM pg_class AS c
  WHERE c.oid = to_regclass('public.catalogue_availability');
  IF NOT COALESCE(v_catalogue_options @> ARRAY['security_barrier=true']::text[], false)
     OR v_catalogue_definition NOT ILIKE '%is_published%true%'
     OR v_catalogue_definition NOT ILIKE '%is_archived%false%' THEN
    RAISE EXCEPTION 'public.catalogue_availability security barrier or visibility filters differ from the reviewed definition; inspect it before applying this migration.';
  END IF;
  IF NOT has_table_privilege('anon', 'public.catalogue_availability', 'SELECT')
     OR has_table_privilege('anon', 'public.products', 'SELECT')
     OR EXISTS (
       SELECT 1
       FROM information_schema.column_privileges AS cp
       WHERE cp.table_schema = 'public'
         AND cp.table_name = 'products'
         AND cp.grantee IN ('anon', 'PUBLIC')
         AND cp.privilege_type = 'SELECT'
     ) THEN
    RAISE EXCEPTION 'Anonymous catalogue grants or direct product-table restrictions differ from the reviewed state.';
  END IF;

  FOREACH v_required_table IN ARRAY ARRAY[
    'admin_users',
    'products',
    'orders',
    'order_items',
    'wholesale_quotes',
    'wholesale_quote_items',
    'stock_movements'
  ] LOOP
    IF to_regclass(format('public.%I', v_required_table)) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing.', v_required_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS c
      WHERE c.oid = to_regclass(format('public.%I', v_required_table))
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS must already be enabled on public.% before applying this migration.', v_required_table;
    END IF;
  END LOOP;

  IF to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class AS c
       WHERE c.oid = to_regclass('storage.objects')
         AND c.relrowsecurity
     )
     OR NOT EXISTS (
       SELECT 1
       FROM storage.buckets AS b
       WHERE b.id = 'product-images'
     ) THEN
    RAISE EXCEPTION 'The product-images Storage bucket and storage.objects RLS must exist before applying role guards.';
  END IF;
END
$$;

CREATE TABLE public.administrator_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('main', 'privileged', 'operational')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.administrator_permissions (
  user_id uuid NOT NULL REFERENCES public.administrator_roles(user_id) ON DELETE CASCADE,
  permission_key text NOT NULL CHECK (permission_key IN (
    'products.read',
    'products.manage',
    'orders.read',
    'orders.manage',
    'wholesale.read',
    'wholesale.manage',
    'settings.business.read',
    'settings.business.manage'
  )),
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE public.admin_role_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  previous_role text CHECK (
    previous_role IS NULL OR previous_role IN ('main', 'privileged', 'operational')
  ),
  requested_role text CHECK (
    requested_role IS NULL OR requested_role IN ('main', 'privileged', 'operational')
  ),
  requested_by uuid NOT NULL,
  required_approver_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX admin_role_change_one_pending_target
ON public.admin_role_change_requests (target_user_id)
WHERE status = 'pending';

CREATE TABLE public.admin_role_change_approvals (
  request_id uuid NOT NULL REFERENCES public.admin_role_change_requests(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, approver_user_id)
);

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.storefront_settings (
  setting_key text PRIMARY KEY CHECK (setting_key IN (
    'brand_name',
    'tagline',
    'location',
    'phone',
    'whatsapp',
    'contact_email',
    'hero_title',
    'hero_text',
    'about_title',
    'about_text',
    'accent_color',
    'facebook_url',
    'instagram_url',
    'tiktok_url',
    'catalogue_message',
    'currency_code',
    'currency_label',
    'currency_locale',
    'order_whatsapp_message',
    'wholesale_whatsapp_message',
    'seo_title',
    'seo_description',
    'seo_image_url'
  )),
  setting_value jsonb NOT NULL CHECK (jsonb_typeof(setting_value) = 'string'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.admin_private_settings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key text NOT NULL CHECK (setting_key IN (
    'dashboard_default_view',
    'dashboard_product_filter'
  )),
  setting_value jsonb NOT NULL CHECK (jsonb_typeof(setting_value) = 'string'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, setting_key)
);

ALTER TABLE public.administrator_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administrator_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_change_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_private_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.admin_users (user_id)
VALUES
  ('6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid),
  ('e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.administrator_roles (user_id, role, created_by)
SELECT user_id, 'operational', NULL
FROM public.admin_users
WHERE user_id NOT IN (
  '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
  'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.administrator_roles (user_id, role, created_by)
VALUES
  ('6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid, 'main', NULL),
  ('e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid, 'main', NULL)
ON CONFLICT (user_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT au.user_id
    FROM public.admin_users AS au
    EXCEPT
    SELECT ar.user_id
    FROM public.administrator_roles AS ar
  ) OR EXISTS (
    SELECT ar.user_id
    FROM public.administrator_roles AS ar
    EXCEPT
    SELECT au.user_id
    FROM public.admin_users AS au
  ) THEN
    RAISE EXCEPTION 'Administrator role and legacy admin membership rows must remain synchronized.';
  END IF;
END
$$;

INSERT INTO public.storefront_settings (setting_key, setting_value)
VALUES
  ('brand_name', to_jsonb('Goodys Textile'::text)),
  ('tagline', to_jsonb('Luxury Fabrics, Endless Possibilities'::text)),
  ('location', to_jsonb('Bamenda Main Market, Cameroon'::text)),
  ('phone', to_jsonb('+237 673 806 848'::text)),
  ('whatsapp', to_jsonb('237673806848'::text)),
  ('contact_email', to_jsonb(''::text)),
  ('hero_title', to_jsonb('Luxury fabrics. Endless possibilities.'::text)),
  ('hero_text', to_jsonb('Premium fabrics selected for fashion designers, tailors, boutiques, bridal and event wear, corporate fashion and individual creations.'::text)),
  ('about_title', to_jsonb('More than fabric. A better selection process.'::text)),
  ('about_text', to_jsonb('From statement prints to elegant suiting and occasion fabrics, Goodys Textile helps you choose the right material for the look you are creating.'::text)),
  ('accent_color', to_jsonb('#c9a24d'::text)),
  ('facebook_url', to_jsonb(''::text)),
  ('instagram_url', to_jsonb(''::text)),
  ('tiktok_url', to_jsonb(''::text)),
  ('catalogue_message', to_jsonb('Browse our selection and contact us to confirm prices and availability.'::text)),
  ('currency_code', to_jsonb('XAF'::text)),
  ('currency_label', to_jsonb('FCFA'::text)),
  ('currency_locale', to_jsonb('en-US'::text)),
  ('order_whatsapp_message', to_jsonb('Hello Goodys Textile, I would like to make an order enquiry.'::text)),
  ('wholesale_whatsapp_message', to_jsonb('Hello Goodys Textile, I am interested in wholesale fabric supply.'::text)),
  ('seo_title', to_jsonb('Goodys Textile — Luxury Fabrics, Endless Possibilities'::text)),
  ('seo_description', to_jsonb('Goodys Textile — premium fabrics in Bamenda Main Market, Cameroon. Retail and wholesale fabrics for designers, tailors, bridal, event and corporate wear.'::text)),
  ('seo_image_url', to_jsonb(''::text))
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.admin_audit_log (
  actor_user_id,
  action,
  resource_type,
  resource_id,
  details
)
VALUES
  (
    NULL,
    'initial_main_administrator_assignment',
    'administrator',
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a',
    '{"source":"reviewed migration","role":"main"}'::jsonb
  ),
  (
    NULL,
    'initial_main_administrator_assignment',
    'administrator',
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07',
    '{"source":"reviewed migration","role":"main"}'::jsonb
  );

CREATE OR REPLACE FUNCTION public.is_admin_identity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.admin_users AS au
        WHERE au.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.administrator_roles AS ar
        WHERE ar.user_id = auth.uid()
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.is_main_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.administrator_roles AS ar
      WHERE ar.user_id = auth.uid()
        AND ar.role = 'main'
        AND ar.is_active
        AND EXISTS (
          SELECT 1
          FROM public.admin_users AS au
          WHERE au.user_id = ar.user_id
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL OR p_permission_key IS NULL THEN
    RETURN false;
  END IF;

  SELECT ar.role
  INTO v_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = auth.uid()
    AND ar.is_active;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
  ) THEN
    RETURN false;
  END IF;

  IF v_role = 'main' THEN
    RETURN true;
  END IF;

  IF p_permission_key = 'dashboard.preferences.manage' THEN
    RETURN true;
  END IF;

  IF v_role = 'operational'
     AND p_permission_key = ANY (ARRAY[
       'products.read',
       'products.manage',
       'orders.read',
       'orders.manage',
       'wholesale.read',
       'wholesale.manage'
     ]::text[]) THEN
    RETURN true;
  END IF;

  IF v_role = 'privileged'
     AND p_permission_key = ANY (ARRAY[
       'products.read',
       'products.manage',
       'orders.read',
       'orders.manage',
       'wholesale.read',
       'wholesale.manage',
       'settings.business.read',
       'settings.business.manage'
     ]::text[]) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.administrator_permissions AS ap
      WHERE ap.user_id = auth.uid()
        AND ap.permission_key = p_permission_key
    ) OR (
      p_permission_key = 'products.read'
      AND EXISTS (
        SELECT 1 FROM public.administrator_permissions AS ap
        WHERE ap.user_id = auth.uid() AND ap.permission_key = 'products.manage'
      )
    ) OR (
      p_permission_key = 'orders.read'
      AND EXISTS (
        SELECT 1 FROM public.administrator_permissions AS ap
        WHERE ap.user_id = auth.uid() AND ap.permission_key = 'orders.manage'
      )
    ) OR (
      p_permission_key = 'wholesale.read'
      AND EXISTS (
        SELECT 1 FROM public.administrator_permissions AS ap
        WHERE ap.user_id = auth.uid() AND ap.permission_key = 'wholesale.manage'
      )
    ) OR (
      p_permission_key = 'settings.business.read'
      AND EXISTS (
        SELECT 1 FROM public.administrator_permissions AS ap
        WHERE ap.user_id = auth.uid() AND ap.permission_key = 'settings.business.manage'
      )
    );
  END IF;

  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.get_admin_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_role text;
  v_permissions text[];
BEGIN
  SELECT ar.role
  INTO v_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = auth.uid()
    AND ar.is_active
    AND EXISTS (
      SELECT 1
      FROM public.admin_users AS au
      WHERE au.user_id = ar.user_id
    );

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'user_id', auth.uid(),
      'role', NULL,
      'permissions', ARRAY[]::text[]
    );
  END IF;

  SELECT COALESCE(
    pg_catalog.array_agg(permission_key ORDER BY permission_key),
    ARRAY[]::text[]
  )
  INTO v_permissions
  FROM pg_catalog.unnest(ARRAY[
    'products.read',
    'products.manage',
    'orders.read',
    'orders.manage',
    'wholesale.read',
    'wholesale.manage',
    'settings.business.read',
    'settings.business.manage',
    'dashboard.preferences.manage',
    'audit.read',
    'infrastructure.read',
    'admin.governance',
    'stock.read'
  ]::text[]) AS permissions(permission_key)
  WHERE public.has_admin_permission(permissions.permission_key);

  RETURN pg_catalog.jsonb_build_object(
    'user_id', auth.uid(),
    'role', v_role,
    'permissions', v_permissions
  );
END
$$;

CREATE OR REPLACE FUNCTION public.write_admin_audit(
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    details
  )
  VALUES (
    auth.uid(),
    p_action,
    p_resource_type,
    p_resource_id,
    COALESCE(p_details, '{}'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.save_storefront_settings(p_settings jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_text text;
  v_previous jsonb;
BEGIN
  IF NOT public.has_admin_permission('settings.business.manage') THEN
    RAISE EXCEPTION 'You are not authorized to manage storefront settings.';
  END IF;
  IF p_settings IS NULL
     OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR p_settings = '{}'::jsonb THEN
    RAISE EXCEPTION 'Provide at least one storefront setting.';
  END IF;

  FOR v_key, v_value IN
    SELECT item.key, item.value
    FROM pg_catalog.jsonb_each(p_settings) AS item
  LOOP
    IF v_key NOT IN (
      'brand_name', 'tagline', 'location', 'phone', 'whatsapp',
      'contact_email', 'hero_title', 'hero_text', 'about_title',
      'about_text', 'accent_color', 'facebook_url', 'instagram_url',
      'tiktok_url', 'catalogue_message', 'currency_code',
      'currency_label', 'currency_locale', 'order_whatsapp_message',
      'wholesale_whatsapp_message', 'seo_title', 'seo_description',
      'seo_image_url'
    ) OR pg_catalog.jsonb_typeof(v_value) <> 'string' THEN
      RAISE EXCEPTION 'Unsupported storefront setting or value type: %.', v_key;
    END IF;

    v_text := pg_catalog.btrim(v_value #>> '{}');
    v_value := pg_catalog.to_jsonb(v_text);
    IF v_key IN (
      'brand_name', 'tagline', 'location', 'phone', 'whatsapp',
      'hero_title', 'about_title', 'accent_color', 'currency_code',
      'currency_label', 'currency_locale', 'seo_title'
    ) AND v_text = '' THEN
      RAISE EXCEPTION 'Setting % cannot be blank.', v_key;
    END IF;
    IF pg_catalog.length(v_text) > CASE v_key
      WHEN 'brand_name' THEN 80
      WHEN 'tagline' THEN 120
      WHEN 'location' THEN 160
      WHEN 'phone' THEN 32
      WHEN 'whatsapp' THEN 20
      WHEN 'contact_email' THEN 254
      WHEN 'hero_title' THEN 140
      WHEN 'hero_text' THEN 700
      WHEN 'about_title' THEN 140
      WHEN 'about_text' THEN 700
      WHEN 'accent_color' THEN 7
      WHEN 'facebook_url' THEN 500
      WHEN 'instagram_url' THEN 500
      WHEN 'tiktok_url' THEN 500
      WHEN 'catalogue_message' THEN 500
      WHEN 'currency_code' THEN 3
      WHEN 'currency_label' THEN 12
      WHEN 'currency_locale' THEN 16
      WHEN 'order_whatsapp_message' THEN 500
      WHEN 'wholesale_whatsapp_message' THEN 500
      WHEN 'seo_title' THEN 160
      WHEN 'seo_description' THEN 320
      WHEN 'seo_image_url' THEN 500
      ELSE 1000
    END THEN
      RAISE EXCEPTION 'Setting % exceeds the maximum length.', v_key;
    END IF;
    IF v_key = 'whatsapp' AND v_text !~ '^[0-9]{7,20}$' THEN
      RAISE EXCEPTION 'WhatsApp must contain 7 to 20 digits.';
    END IF;
    IF v_key = 'phone' AND pg_catalog.length(v_text) > 32 THEN
      RAISE EXCEPTION 'Phone number is too long.';
    END IF;
    IF v_key = 'contact_email'
       AND v_text <> ''
       AND v_text !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Contact email is not valid.';
    END IF;
    IF v_key = 'accent_color' AND v_text !~ '^#[0-9A-Fa-f]{6}$' THEN
      RAISE EXCEPTION 'Accent color must be a six-digit hexadecimal color.';
    END IF;
    IF v_key IN ('facebook_url', 'instagram_url', 'tiktok_url', 'seo_image_url')
       AND v_text <> ''
       AND v_text !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'Setting % must be blank or an HTTPS URL.', v_key;
    END IF;
    IF v_key = 'currency_code' AND v_text !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'Currency code must be a three-letter uppercase code.';
    END IF;
    IF v_key = 'currency_label'
       AND (v_text = '' OR pg_catalog.length(v_text) > 12) THEN
      RAISE EXCEPTION 'Currency label must contain 1 to 12 characters.';
    END IF;
    IF v_key = 'currency_locale'
       AND v_text !~ '^[a-z]{2}(-[A-Z]{2})?$' THEN
      RAISE EXCEPTION 'Locale must use a supported form such as en-US.';
    END IF;

    SELECT ss.setting_value
    INTO v_previous
    FROM public.storefront_settings AS ss
    WHERE ss.setting_key = v_key
    FOR UPDATE;

    INSERT INTO public.storefront_settings (
      setting_key,
      setting_value,
      updated_by,
      updated_at
    )
    VALUES (v_key, v_value, auth.uid(), now())
    ON CONFLICT (setting_key) DO UPDATE
      SET setting_value = EXCLUDED.setting_value,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;

    IF v_previous IS DISTINCT FROM v_value THEN
      PERFORM public.write_admin_audit(
        'update_storefront_setting',
        'storefront_setting',
        v_key,
        pg_catalog.jsonb_build_object('old_value', v_previous, 'new_value', v_value)
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.save_admin_preferences(p_settings jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_text text;
  v_previous jsonb;
BEGIN
  IF NOT public.has_admin_permission('dashboard.preferences.manage') THEN
    RAISE EXCEPTION 'You are not authorized to save dashboard preferences.';
  END IF;
  IF p_settings IS NULL
     OR pg_catalog.jsonb_typeof(p_settings) <> 'object'
     OR p_settings = '{}'::jsonb THEN
    RAISE EXCEPTION 'Provide at least one dashboard preference.';
  END IF;

  FOR v_key, v_value IN
    SELECT item.key, item.value
    FROM pg_catalog.jsonb_each(p_settings) AS item
  LOOP
    v_text := v_value #>> '{}';
    IF pg_catalog.jsonb_typeof(v_value) <> 'string' THEN
      RAISE EXCEPTION 'Dashboard preference values must be text.';
    END IF;
    IF (v_key = 'dashboard_default_view' AND v_text NOT IN ('overview', 'products'))
       OR (v_key = 'dashboard_product_filter' AND v_text NOT IN ('active', 'archived'))
       OR v_key NOT IN ('dashboard_default_view', 'dashboard_product_filter') THEN
      RAISE EXCEPTION 'Unsupported dashboard preference or value: %.', v_key;
    END IF;

    SELECT aps.setting_value
    INTO v_previous
    FROM public.admin_private_settings AS aps
    WHERE aps.user_id = auth.uid()
      AND aps.setting_key = v_key
    FOR UPDATE;

    INSERT INTO public.admin_private_settings (
      user_id,
      setting_key,
      setting_value,
      updated_at
    )
    VALUES (auth.uid(), v_key, v_value, now())
    ON CONFLICT (user_id, setting_key) DO UPDATE
      SET setting_value = EXCLUDED.setting_value,
          updated_at = EXCLUDED.updated_at;

    IF v_previous IS DISTINCT FROM v_value THEN
      PERFORM public.write_admin_audit(
        'update_admin_preference',
        'admin_private_setting',
        v_key,
        pg_catalog.jsonb_build_object('old_value', v_previous, 'new_value', v_value)
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.set_admin_role(p_target_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_current_role text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can manage administrator roles.';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'A target Auth user ID is required.';
  END IF;
  IF p_target_user_id = ANY (ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ]) THEN
    PERFORM public.write_admin_audit(
      'reject_protected_main_admin_role_change',
      'administrator',
      p_target_user_id::text,
      pg_catalog.jsonb_build_object('requested_role', p_role)
    );
    RETURN false;
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own role.';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('privileged', 'operational') THEN
    RAISE EXCEPTION 'Use the dual-approval workflow for Main Administrator changes.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_target_user_id
      AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The target Auth user ID does not exist or is not email-confirmed.';
  END IF;

  SELECT ar.role INTO v_current_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = p_target_user_id;

  IF v_current_role = 'main' THEN
    RAISE EXCEPTION 'Main Administrator changes require the dual-approval workflow.';
  END IF;

  IF p_role IS NULL THEN
    DELETE FROM public.administrator_permissions
    WHERE user_id = p_target_user_id;
    DELETE FROM public.administrator_roles
    WHERE user_id = p_target_user_id;
    DELETE FROM public.admin_users
    WHERE user_id = p_target_user_id;
    PERFORM public.write_admin_audit(
      'remove_administrator',
      'administrator',
      p_target_user_id::text,
      '{}'::jsonb
    );
    RETURN true;
  END IF;

  INSERT INTO public.admin_users (user_id)
  VALUES (p_target_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.administrator_roles (
    user_id,
    role,
    is_active,
    created_by,
    updated_by,
    updated_at
  )
  VALUES (
    p_target_user_id,
    p_role,
    true,
    auth.uid(),
    auth.uid(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = true,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

  IF p_role <> 'privileged' THEN
    DELETE FROM public.administrator_permissions
    WHERE user_id = p_target_user_id;
  END IF;

  PERFORM public.write_admin_audit(
    'set_administrator_role',
    'administrator',
    p_target_user_id::text,
    pg_catalog.jsonb_build_object('old_role', v_current_role, 'new_role', p_role)
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.set_admin_permission(
  p_target_user_id uuid,
  p_permission_key text,
  p_granted boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can change delegated permissions.';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'A target Auth user ID is required.';
  END IF;
  IF p_target_user_id = ANY (ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ]) THEN
    PERFORM public.write_admin_audit(
      'reject_protected_main_admin_permission_change',
      'administrator',
      p_target_user_id::text,
      pg_catalog.jsonb_build_object(
        'permission', p_permission_key,
        'granted', p_granted
      )
    );
    RETURN false;
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own permissions.';
  END IF;
  IF p_permission_key IS NULL OR p_granted IS NULL THEN
    RAISE EXCEPTION 'Permission key and grant state are required.';
  END IF;
  IF p_permission_key NOT IN (
    'products.read', 'products.manage',
    'orders.read', 'orders.manage',
    'wholesale.read', 'wholesale.manage',
    'settings.business.read', 'settings.business.manage'
  ) THEN
    RAISE EXCEPTION 'This permission cannot be delegated.';
  END IF;

  SELECT ar.role INTO v_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = p_target_user_id
    AND ar.is_active;
  IF v_role IS DISTINCT FROM 'privileged' THEN
    RAISE EXCEPTION 'Custom permissions can only be assigned to an active Privileged Administrator.';
  END IF;

  IF p_granted THEN
    INSERT INTO public.administrator_permissions (
      user_id,
      permission_key,
      granted_by
    )
    VALUES (p_target_user_id, p_permission_key, auth.uid())
    ON CONFLICT (user_id, permission_key) DO UPDATE
      SET granted_by = EXCLUDED.granted_by,
          granted_at = now();
  ELSE
    DELETE FROM public.administrator_permissions
    WHERE user_id = p_target_user_id
      AND permission_key = p_permission_key;
  END IF;

  PERFORM public.write_admin_audit(
    CASE WHEN p_granted THEN 'grant_admin_permission' ELSE 'revoke_admin_permission' END,
    'administrator_permission',
    p_target_user_id::text,
    pg_catalog.jsonb_build_object('permission', p_permission_key)
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.set_admin_status(
  p_target_user_id uuid,
  p_is_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can suspend or restore an administrator.';
  END IF;
  IF p_target_user_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Invalid administrator status request.';
  END IF;
  IF p_target_user_id = ANY (ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ]) THEN
    PERFORM public.write_admin_audit(
      'reject_protected_main_admin_status_change',
      'administrator',
      p_target_user_id::text,
      pg_catalog.jsonb_build_object('requested_is_active', p_is_active)
    );
    RETURN false;
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own status.';
  END IF;

  SELECT ar.role INTO v_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = p_target_user_id;
  IF v_role IS NULL OR v_role = 'main' THEN
    RAISE EXCEPTION 'Only an assigned non-Main Administrator can be suspended or restored.';
  END IF;

  UPDATE public.administrator_roles
  SET is_active = p_is_active,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE user_id = p_target_user_id;

  PERFORM public.write_admin_audit(
    CASE WHEN p_is_active THEN 'restore_administrator' ELSE 'suspend_administrator' END,
    'administrator',
    p_target_user_id::text,
    pg_catalog.jsonb_build_object('role', v_role, 'is_active', p_is_active)
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.request_admin_role_change(
  p_target_user_id uuid,
  p_requested_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_current_role text;
  v_approvers uuid[];
  v_request_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can request a Main Administrator roster change.';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'A target Auth user ID is required.';
  END IF;
  IF p_target_user_id = ANY (ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ]) THEN
    PERFORM public.write_admin_audit(
      'reject_protected_main_admin_roster_change',
      'administrator',
      p_target_user_id::text,
      pg_catalog.jsonb_build_object('requested_role', p_requested_role)
    );
    RETURN NULL;
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot request a change to their own role.';
  END IF;
  IF p_requested_role IS NOT NULL
     AND p_requested_role NOT IN ('main', 'privileged', 'operational') THEN
    RAISE EXCEPTION 'Requested role is invalid.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_target_user_id
      AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The target Auth user ID does not exist or is not email-confirmed.';
  END IF;

  SELECT ar.role INTO v_current_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = p_target_user_id
    AND ar.is_active;

  IF v_current_role IS DISTINCT FROM 'main'
     AND p_requested_role IS DISTINCT FROM 'main' THEN
    RAISE EXCEPTION 'Use direct Main Administrator management for non-Main roles.';
  END IF;
  IF v_current_role = p_requested_role THEN
    RAISE EXCEPTION 'The target already has the requested role.';
  END IF;
  IF v_current_role = 'main' AND p_requested_role IS DISTINCT FROM 'main'
     AND (
       SELECT pg_catalog.count(*)
       FROM public.administrator_roles AS ar
       WHERE ar.role = 'main'
         AND ar.is_active
     ) <= 1 THEN
    RAISE EXCEPTION 'At least one Main Administrator must remain active.';
  END IF;

  v_approvers := ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ];
  IF (
    SELECT pg_catalog.count(*)
    FROM public.administrator_roles AS ar
    JOIN public.admin_users AS au ON au.user_id = ar.user_id
    WHERE ar.user_id = ANY (v_approvers)
      AND ar.role = 'main'
      AND ar.is_active
  ) <> pg_catalog.cardinality(v_approvers) THEN
    PERFORM public.write_admin_audit(
      'reject_main_roster_change_missing_original_approvers',
      'administrator_role_change_request',
      p_target_user_id::text,
      pg_catalog.jsonb_build_object('requested_role', p_requested_role)
    );
    RETURN NULL;
  END IF;

  INSERT INTO public.admin_role_change_requests (
    target_user_id,
    previous_role,
    requested_role,
    requested_by,
    required_approver_ids
  )
  VALUES (
    p_target_user_id,
    v_current_role,
    p_requested_role,
    auth.uid(),
    v_approvers
  )
  RETURNING id INTO v_request_id;

  PERFORM public.write_admin_audit(
    'request_main_roster_change',
    'administrator_role_change_request',
    v_request_id::text,
    pg_catalog.jsonb_build_object(
      'target_user_id', p_target_user_id,
      'current_role', v_current_role,
      'requested_role', p_requested_role
    )
  );
  RETURN v_request_id;
END
$$;

CREATE OR REPLACE FUNCTION public.approve_admin_role_change(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_request public.admin_role_change_requests%ROWTYPE;
  v_current_approvers uuid[];
  v_approval_count integer;
  v_current_role text;
  v_original_approvers uuid[] := ARRAY[
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a'::uuid,
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'::uuid
  ];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only an active Main Administrator can approve a roster change.';
  END IF;

  SELECT *
  INTO v_request
  FROM public.admin_role_change_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending role-change request was not found.';
  END IF;
  IF v_request.target_user_id = ANY (v_original_approvers) THEN
    UPDATE public.admin_role_change_requests
    SET status = 'cancelled',
        completed_at = now()
    WHERE id = p_request_id;
    PERFORM public.write_admin_audit(
      'reject_protected_main_admin_roster_change',
      'administrator_role_change_request',
      p_request_id::text,
      pg_catalog.jsonb_build_object('target_user_id', v_request.target_user_id)
    );
    RETURN false;
  END IF;
  IF auth.uid() = v_request.target_user_id THEN
    UPDATE public.admin_role_change_requests
    SET status = 'cancelled',
        completed_at = now()
    WHERE id = p_request_id;
    PERFORM public.write_admin_audit(
      'reject_self_approval',
      'administrator_role_change_request',
      p_request_id::text,
      pg_catalog.jsonb_build_object('target_user_id', v_request.target_user_id)
    );
    RETURN false;
  END IF;
  IF v_request.required_approver_ids IS DISTINCT FROM v_original_approvers THEN
    UPDATE public.admin_role_change_requests
    SET status = 'cancelled',
        completed_at = now()
    WHERE id = p_request_id;
    PERFORM public.write_admin_audit(
      'reject_invalid_main_approval_set',
      'administrator_role_change_request',
      p_request_id::text,
      pg_catalog.jsonb_build_object(
        'target_user_id', v_request.target_user_id,
        'required_approver_ids', v_request.required_approver_ids
      )
    );
    RETURN false;
  END IF;
  IF auth.uid() <> ALL (v_request.required_approver_ids) THEN
    RAISE EXCEPTION 'This Main Administrator was not included in the approval set.';
  END IF;

  SELECT pg_catalog.array_agg(ar.user_id ORDER BY ar.user_id)
  INTO v_current_approvers
  FROM public.administrator_roles AS ar
  JOIN public.admin_users AS au ON au.user_id = ar.user_id
  WHERE ar.user_id = ANY (v_original_approvers)
    AND ar.role = 'main'
    AND ar.is_active;
  IF v_current_approvers IS DISTINCT FROM v_original_approvers THEN
    UPDATE public.admin_role_change_requests
    SET status = 'cancelled',
        completed_at = now()
    WHERE id = p_request_id;
    PERFORM public.write_admin_audit(
      'reject_main_roster_change_missing_original_approvers',
      'administrator_role_change_request',
      p_request_id::text,
      pg_catalog.jsonb_build_object('target_user_id', v_request.target_user_id)
    );
    RETURN false;
  END IF;

  INSERT INTO public.admin_role_change_approvals (request_id, approver_user_id)
  VALUES (p_request_id, auth.uid())
  ON CONFLICT (request_id, approver_user_id) DO NOTHING;

  SELECT pg_catalog.count(*)
  INTO v_approval_count
  FROM public.admin_role_change_approvals AS a
  WHERE a.request_id = p_request_id
    AND a.approver_user_id = ANY (v_request.required_approver_ids);

  PERFORM public.write_admin_audit(
    'approve_main_roster_change',
    'administrator_role_change_request',
    p_request_id::text,
    pg_catalog.jsonb_build_object('approval_count', v_approval_count)
  );

  IF v_approval_count < pg_catalog.cardinality(v_request.required_approver_ids) THEN
    RETURN false;
  END IF;

  SELECT ar.role INTO v_current_role
  FROM public.administrator_roles AS ar
  WHERE ar.user_id = v_request.target_user_id
    AND ar.is_active;

  IF v_current_role IS DISTINCT FROM v_request.previous_role THEN
    RAISE EXCEPTION 'The target administrator role changed; cancel and submit a new request.';
  END IF;
  IF v_current_role = 'main'
     AND v_request.requested_role IS DISTINCT FROM 'main'
     AND (
       SELECT pg_catalog.count(*)
       FROM public.administrator_roles AS ar
       WHERE ar.role = 'main'
         AND ar.is_active
     ) <= 1 THEN
    RAISE EXCEPTION 'At least one Main Administrator must remain active.';
  END IF;
  IF v_request.requested_role = 'main' AND v_current_role = 'main' THEN
    RAISE EXCEPTION 'The target is already a Main Administrator.';
  END IF;

  IF v_request.requested_role IS NULL THEN
    DELETE FROM public.administrator_permissions
    WHERE user_id = v_request.target_user_id;
    DELETE FROM public.administrator_roles
    WHERE user_id = v_request.target_user_id;
    DELETE FROM public.admin_users
    WHERE user_id = v_request.target_user_id;
  ELSE
    INSERT INTO public.admin_users (user_id)
    VALUES (v_request.target_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.administrator_roles (
      user_id,
      role,
      is_active,
      created_by,
      updated_by,
      updated_at
    )
    VALUES (
      v_request.target_user_id,
      v_request.requested_role,
      true,
      auth.uid(),
      auth.uid(),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_active = true,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;

    IF v_request.requested_role <> 'privileged' THEN
      DELETE FROM public.administrator_permissions
      WHERE user_id = v_request.target_user_id;
    END IF;
  END IF;

  UPDATE public.admin_role_change_requests
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_request_id;

  PERFORM public.write_admin_audit(
    'complete_main_roster_change',
    'administrator',
    v_request.target_user_id::text,
    pg_catalog.jsonb_build_object(
      'old_role', v_current_role,
      'new_role', v_request.requested_role,
      'request_id', p_request_id
    )
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.cancel_admin_role_change(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  v_request public.admin_role_change_requests%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(685423, 1);
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can cancel a roster-change request.';
  END IF;

  SELECT *
  INTO v_request
  FROM public.admin_role_change_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending role-change request was not found.';
  END IF;

  UPDATE public.admin_role_change_requests
  SET status = 'cancelled'
  WHERE id = p_request_id;

  PERFORM public.write_admin_audit(
    'cancel_main_roster_change',
    'administrator_role_change_request',
    p_request_id::text,
    pg_catalog.jsonb_build_object('target_user_id', v_request.target_user_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.list_administrators()
RETURNS TABLE (
  user_id uuid,
  role text,
  is_active boolean,
  permissions text[],
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can view administrator assignments.';
  END IF;

  RETURN QUERY
  SELECT
    ar.user_id,
    ar.role,
    ar.is_active,
    COALESCE(
      ARRAY(
        SELECT ap.permission_key
        FROM public.administrator_permissions AS ap
        WHERE ap.user_id = ar.user_id
        ORDER BY ap.permission_key
      ),
      ARRAY[]::text[]
    ),
    ar.created_at,
    ar.updated_at
  FROM public.administrator_roles AS ar
  ORDER BY ar.role, ar.user_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_admin_role_change_requests()
RETURNS TABLE (
  request_id uuid,
  target_user_id uuid,
  requested_role text,
  requested_by uuid,
  status text,
  created_at timestamptz,
  required_approver_ids uuid[],
  approved_by uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF NOT public.is_main_admin() THEN
    RAISE EXCEPTION 'Only a Main Administrator can view roster-change requests.';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.target_user_id,
    r.requested_role,
    r.requested_by,
    r.status,
    r.created_at,
    r.required_approver_ids,
    COALESCE(
      ARRAY(
        SELECT a.approver_user_id
        FROM public.admin_role_change_approvals AS a
        WHERE a.request_id = r.id
        ORDER BY a.approver_user_id
      ),
      ARRAY[]::uuid[]
    )
  FROM public.admin_role_change_requests AS r
  ORDER BY r.created_at DESC
  LIMIT 100;
END
$$;

CREATE OR REPLACE FUNCTION public.get_admin_audit_log(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  action text,
  resource_type text,
  resource_id text,
  details jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF NOT public.has_admin_permission('audit.read') THEN
    RAISE EXCEPTION 'Only a Main Administrator can view the audit log.';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.actor_user_id,
    a.action,
    a.resource_type,
    a.resource_id,
    a.details,
    a.occurred_at
  FROM public.admin_audit_log AS a
  ORDER BY a.occurred_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
END
$$;

CREATE OR REPLACE VIEW public.storefront_settings_public
WITH (security_barrier = true)
AS
SELECT setting_key, setting_value
FROM public.storefront_settings
WHERE setting_key IN (
  'brand_name', 'tagline', 'location', 'phone', 'whatsapp',
  'contact_email', 'hero_title', 'hero_text', 'about_title',
  'about_text', 'accent_color', 'facebook_url', 'instagram_url',
  'tiktok_url', 'catalogue_message', 'currency_code',
  'currency_label', 'currency_locale', 'order_whatsapp_message',
  'wholesale_whatsapp_message', 'seo_title', 'seo_description',
  'seo_image_url'
);

CREATE POLICY administrator_roles_main_read
ON public.administrator_roles
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.is_main_admin());

CREATE POLICY administrator_permissions_main_read
ON public.administrator_permissions
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.is_main_admin());

CREATE POLICY admin_role_change_requests_main_read
ON public.admin_role_change_requests
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.is_main_admin());

CREATE POLICY admin_role_change_approvals_main_read
ON public.admin_role_change_approvals
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.is_main_admin());

CREATE POLICY admin_audit_log_main_read
ON public.admin_audit_log
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.has_admin_permission('audit.read'));

CREATE POLICY storefront_settings_authorized_read
ON public.storefront_settings
AS PERMISSIVE
FOR SELECT TO authenticated
USING (public.has_admin_permission('settings.business.read'));

CREATE POLICY admin_private_settings_self_read
ON public.admin_private_settings
AS PERMISSIVE
FOR SELECT TO authenticated
USING (
  public.has_admin_permission('dashboard.preferences.manage')
  AND user_id = auth.uid()
);

CREATE POLICY products_role_select
ON public.products
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('products.read')
);

CREATE POLICY products_role_insert
ON public.products
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('products.manage')
);

CREATE POLICY products_role_update
ON public.products
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('products.manage')
)
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('products.manage')
);

CREATE POLICY products_no_permanent_delete
ON public.products
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (false);

CREATE POLICY orders_role_select
ON public.orders
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.read')
);

CREATE POLICY orders_role_insert
ON public.orders
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
);

CREATE POLICY orders_role_update
ON public.orders
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
)
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
);

CREATE POLICY orders_no_delete
ON public.orders
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (NOT public.is_admin_identity());

CREATE POLICY order_items_role_select
ON public.order_items
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.read')
);

CREATE POLICY order_items_role_insert
ON public.order_items
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
);

CREATE POLICY order_items_role_update
ON public.order_items
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
)
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('orders.manage')
);

CREATE POLICY order_items_no_delete
ON public.order_items
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (NOT public.is_admin_identity());

CREATE POLICY wholesale_quotes_role_select
ON public.wholesale_quotes
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.read')
);

CREATE POLICY wholesale_quotes_role_insert
ON public.wholesale_quotes
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
);

CREATE POLICY wholesale_quotes_role_update
ON public.wholesale_quotes
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
)
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
);

CREATE POLICY wholesale_quotes_no_delete
ON public.wholesale_quotes
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (NOT public.is_admin_identity());

CREATE POLICY wholesale_quote_items_role_select
ON public.wholesale_quote_items
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.read')
);

CREATE POLICY wholesale_quote_items_role_insert
ON public.wholesale_quote_items
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
);

CREATE POLICY wholesale_quote_items_role_update
ON public.wholesale_quote_items
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
)
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('wholesale.manage')
);

CREATE POLICY wholesale_quote_items_no_delete
ON public.wholesale_quote_items
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (NOT public.is_admin_identity());

CREATE POLICY stock_movements_main_read
ON public.stock_movements
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (
  NOT public.is_admin_identity()
  OR public.has_admin_permission('stock.read')
);

CREATE POLICY stock_movements_main_insert
ON public.stock_movements
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_admin_identity()
  OR public.is_main_admin()
);

CREATE POLICY stock_movements_no_update
ON public.stock_movements
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (NOT public.is_admin_identity())
WITH CHECK (NOT public.is_admin_identity());

CREATE POLICY stock_movements_no_delete
ON public.stock_movements
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (NOT public.is_admin_identity());

CREATE POLICY admin_users_main_select
ON public.admin_users
AS RESTRICTIVE
FOR SELECT TO authenticated
USING (public.is_main_admin());

CREATE POLICY admin_users_no_direct_insert
ON public.admin_users
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY admin_users_no_direct_update
ON public.admin_users
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY admin_users_no_direct_delete
ON public.admin_users
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (false);

CREATE POLICY admin_private_settings_no_direct_insert
ON public.admin_private_settings
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY admin_private_settings_no_direct_update
ON public.admin_private_settings
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY admin_private_settings_no_direct_delete
ON public.admin_private_settings
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (false);

-- Reviewed against the existing gt_product_images_* policies: these guards limit mutations
-- to Main and Privileged Administrators with products.manage and do not alter public reads.
CREATE POLICY product_images_role_insert_guard
ON storage.objects
AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id <> 'product-images'
  OR (
    public.is_admin_identity()
    AND (public.get_admin_context() ->> 'role') IN ('main', 'privileged')
    AND public.has_admin_permission('products.manage')
  )
);

CREATE POLICY product_images_role_update_guard
ON storage.objects
AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  bucket_id <> 'product-images'
  OR (
    public.is_admin_identity()
    AND (public.get_admin_context() ->> 'role') IN ('main', 'privileged')
    AND public.has_admin_permission('products.manage')
  )
)
WITH CHECK (
  bucket_id <> 'product-images'
  OR (
    public.is_admin_identity()
    AND (public.get_admin_context() ->> 'role') IN ('main', 'privileged')
    AND public.has_admin_permission('products.manage')
  )
);

CREATE POLICY product_images_role_delete_guard
ON storage.objects
AS RESTRICTIVE
FOR DELETE TO authenticated
USING (
  bucket_id <> 'product-images'
  OR (
    public.is_admin_identity()
    AND (public.get_admin_context() ->> 'role') IN ('main', 'privileged')
    AND public.has_admin_permission('products.manage')
  )
);

REVOKE ALL ON TABLE
  public.administrator_roles,
  public.administrator_permissions,
  public.admin_role_change_requests,
  public.admin_role_change_approvals,
  public.admin_audit_log,
  public.storefront_settings,
  public.admin_private_settings
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.storefront_settings,
  public.admin_private_settings
TO authenticated;

REVOKE ALL ON TABLE public.storefront_settings_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.storefront_settings_public TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.admin_users FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_admin_identity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_main_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_admin_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.write_admin_audit(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_storefront_settings(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_admin_preferences(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_admin_role(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_admin_permission(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_admin_status(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_admin_role_change(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_admin_role_change(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_admin_role_change(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_administrators() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admin_role_change_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_audit_log(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_main_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_storefront_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_preferences(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_permission(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_admin_role_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_admin_role_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_admin_role_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_administrators() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_role_change_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(integer) TO authenticated;

COMMIT;
