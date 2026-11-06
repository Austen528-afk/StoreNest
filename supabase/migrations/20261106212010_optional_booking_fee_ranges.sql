-- Allow optional single amounts or ranges for Catering & Decor service costs and booking fees.
ALTER TABLE public.business_items
  ADD COLUMN booking_fee_min numeric,
  ADD COLUMN booking_fee_max numeric;

ALTER TABLE public.business_items
  DROP CONSTRAINT IF EXISTS business_items_price_range_order;

ALTER TABLE public.business_items
  ADD CONSTRAINT business_items_price_range_order
    CHECK (
      price_range_min IS NULL
      OR price_range_max IS NULL
      OR price_range_max >= price_range_min
    ),
  ADD CONSTRAINT business_items_booking_fee_min_nonnegative
    CHECK (booking_fee_min IS NULL OR booking_fee_min >= 0),
  ADD CONSTRAINT business_items_booking_fee_max_nonnegative
    CHECK (booking_fee_max IS NULL OR booking_fee_max >= 0),
  ADD CONSTRAINT business_items_booking_fee_range_order
    CHECK (
      booking_fee_min IS NULL
      OR booking_fee_max IS NULL
      OR booking_fee_max >= booking_fee_min
    );
