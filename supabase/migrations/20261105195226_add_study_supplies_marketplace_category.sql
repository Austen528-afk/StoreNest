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
    'beauty',
    'home-living',
    'groceries',
    'local-services',
    'gifts-occasions',
    'other'
  ]::text[]));
