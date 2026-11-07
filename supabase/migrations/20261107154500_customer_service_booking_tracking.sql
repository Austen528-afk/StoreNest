-- Customers can safely track service requests separately from product orders.
-- A booking belongs to an authenticated customer when customer_user_id is set;
-- guests can only check a booking using its unguessable, per-request token.
ALTER TABLE public.service_booking_requests
  ADD COLUMN IF NOT EXISTS customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_token uuid;

CREATE INDEX IF NOT EXISTS service_booking_requests_customer_created_idx
  ON public.service_booking_requests(customer_user_id, created_at DESC)
  WHERE customer_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_booking_requests_tracking_token_idx
  ON public.service_booking_requests(tracking_token)
  WHERE tracking_token IS NOT NULL;

ALTER TABLE public.service_booking_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can request a published available service" ON public.service_booking_requests;
CREATE POLICY "Public can request a published available service"
  ON public.service_booking_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND (customer_user_id IS NULL OR customer_user_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.businesses b
      JOIN public.business_items i ON i.business_id = b.id
      WHERE b.id = service_booking_requests.business_id
        AND i.id = service_booking_requests.item_id
        AND b.is_published = true
        AND i.item_type = 'service'
        AND i.is_available = true
    )
  );

DROP POLICY IF EXISTS "Customers can read their own service bookings" ON public.service_booking_requests;
CREATE POLICY "Customers can read their own service bookings"
  ON public.service_booking_requests
  FOR SELECT TO authenticated
  USING (customer_user_id = (SELECT auth.uid()));

-- Table privileges are separate from RLS. Keep guest access insert-only.
GRANT INSERT ON public.service_booking_requests TO anon;
GRANT INSERT, SELECT ON public.service_booking_requests TO authenticated;
GRANT UPDATE (status, updated_at) ON public.service_booking_requests TO authenticated;

-- An opaque booking id AND an independent random tracking token are required.
-- Return status and public service labels only: never expose customer contacts,
-- private notes or other booking details through a guest progress check.
CREATE OR REPLACE FUNCTION public.get_service_booking_progress(
  p_booking_id uuid, p_tracking_token uuid
)
RETURNS TABLE(
  booking_id uuid,
  booking_status text,
  business_name text,
  service_name text,
  event_date date,
  created_at timestamptz,
  updated_at timestamptz
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
REVOKE ALL ON FUNCTION public.get_service_booking_progress(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_booking_progress(uuid,uuid) TO anon, authenticated;
