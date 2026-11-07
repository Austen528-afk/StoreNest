-- Let the signed-in owner inbox receive changes as bookings are submitted.
-- The owner-bookings client still filters by business_id, and table RLS limits
-- change visibility to the owner of that business.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'service_booking_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.service_booking_requests;
  END IF;
END;
$migration$;
