-- Optional booking pricing for Catering and Decor Services.
-- Existing fixed-price items and all other storefront categories remain unchanged.
ALTER TABLE public.business_items
  ADD COLUMN price_range_min numeric,
  ADD COLUMN price_range_max numeric,
  ADD COLUMN booking_fee numeric,
  ADD CONSTRAINT business_items_price_range_min_nonnegative
    CHECK (price_range_min IS NULL OR price_range_min >= 0),
  ADD CONSTRAINT business_items_price_range_max_nonnegative
    CHECK (price_range_max IS NULL OR price_range_max >= 0),
  ADD CONSTRAINT business_items_booking_fee_nonnegative
    CHECK (booking_fee IS NULL OR booking_fee >= 0),
  ADD CONSTRAINT business_items_price_range_order
    CHECK (
      price_range_max IS NULL
      OR (price_range_min IS NOT NULL AND price_range_max >= price_range_min)
    );
