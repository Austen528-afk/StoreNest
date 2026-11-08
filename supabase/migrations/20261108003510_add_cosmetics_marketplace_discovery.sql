-- Add the Cosmetics marketplace category to section classifications and discovery.
-- Include Study Supplies in the browse allowlist as well; it was added to the category
-- selector and section constraint, but not to the discovery function.
ALTER TABLE public.business_categories
  DROP CONSTRAINT IF EXISTS business_categories_marketplace_category_check;

ALTER TABLE public.business_categories
  ADD CONSTRAINT business_categories_marketplace_category_check
  CHECK (marketplace_category = ANY (ARRAY[
    'food-drink',
    'events-decor',
    'electronics',
    'study-supplies',
    'fashion',
    'cosmetics',
    'beauty',
    'home-living',
    'groceries',
    'local-services',
    'gifts-occasions',
    'other'
  ]::text[]));

CREATE OR REPLACE FUNCTION public.browse_storenest_category(category_slug text)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  category text,
  description text,
  location text,
  logo_url text,
  section_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT b.id, b.name, b.slug, b.category, b.description, b.location, b.logo_url,
         matched_section.id AS section_id
  FROM public.businesses b
  LEFT JOIN LATERAL (
    SELECT c.id
    FROM public.business_categories c
    WHERE c.business_id = b.id
      AND c.marketplace_category = category_slug
      AND EXISTS (
        SELECT 1
        FROM public.business_items i
        WHERE i.business_id = b.id
          AND i.category_id = c.id
          AND i.is_available = true
      )
    ORDER BY c.display_order, c.id
    LIMIT 1
  ) matched_section ON true
  WHERE b.is_published = true
    AND (
      (b.category = category_slug AND category_slug IN
        ('food-drink','events-decor','electronics','study-supplies','fashion',
         'cosmetics','beauty','home-living','groceries','local-services',
         'gifts-occasions','other'))
      OR (b.category = 'Food & Drink' AND category_slug = 'food-drink')
      OR (b.category = 'Food & Drinks' AND category_slug = 'food-drink')
      OR (b.category IN ('Home & Decor','Events & Entertainment','Catering and Decor Services')
          AND category_slug = 'events-decor')
      OR (b.category IN ('Beauty & Wellness','Personal Care Services and Products')
          AND category_slug = 'beauty')
      OR (b.category IN ('Professional Services','Local Services')
          AND category_slug = 'local-services')
      OR (b.category = 'Electronics' AND category_slug = 'electronics')
      OR (b.category = 'Fashion & Accessories' AND category_slug = 'fashion')
      OR (b.category = 'Home & Living' AND category_slug = 'home-living')
      OR (b.category = 'Groceries & Essentials' AND category_slug = 'groceries')
      OR (b.category = 'Gifts & Occasions' AND category_slug = 'gifts-occasions')
      OR (b.category = 'Retail' AND category_slug IN
        ('electronics','fashion','home-living','groceries','gifts-occasions','other')
        AND matched_section.id IS NOT NULL)
      OR (b.category = 'Other'
          AND (matched_section.id IS NOT NULL OR category_slug = 'other'))
    )
  ORDER BY lower(b.name), b.id
  LIMIT 80;
$function$;

REVOKE ALL ON FUNCTION public.browse_storenest_category(text) FROM public;
GRANT EXECUTE ON FUNCTION public.browse_storenest_category(text) TO anon, authenticated;
