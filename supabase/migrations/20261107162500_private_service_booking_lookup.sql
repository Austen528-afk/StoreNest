-- Keep the privileged booking lookup outside the Data API exposed schemas.
-- The public API surface is an invoker-rights wrapper; the private implementation
-- only reveals status/public labels when BOTH random values match.
CREATE SCHEMA IF NOT EXISTS storenest_booking_private;
REVOKE ALL ON SCHEMA storenest_booking_private FROM PUBLIC;
GRANT USAGE ON SCHEMA storenest_booking_private TO anon, authenticated;

CREATE OR REPLACE FUNCTION storenest_booking_private.lookup_progress(
  p_booking_id uuid, p_tracking_token uuid
)
RETURNS TABLE(
  booking_id uuid, booking_status text, business_name text, service_name text,
  event_date date, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.status, b.name, i.name, r.event_date, r.created_at, r.updated_at
  FROM public.service_booking_requests r
  JOIN public.businesses b ON b.id = r.business_id
  JOIN public.business_items i ON i.id = r.item_id
  WHERE r.id = p_booking_id
    AND r.tracking_token IS NOT NULL
    AND r.tracking_token = p_tracking_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION storenest_booking_private.lookup_progress(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storenest_booking_private.lookup_progress(uuid,uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_service_booking_progress(
  p_booking_id uuid, p_tracking_token uuid
)
RETURNS TABLE(
  booking_id uuid, booking_status text, business_name text, service_name text,
  event_date date, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM storenest_booking_private.lookup_progress(p_booking_id, p_tracking_token);
$$;
REVOKE ALL ON FUNCTION public.get_service_booking_progress(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_booking_progress(uuid,uuid) TO anon, authenticated;
