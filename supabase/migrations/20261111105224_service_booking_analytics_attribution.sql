-- Link a booking request to the same privacy-minimal storefront session used for item views.
alter table public.service_booking_requests
  add column if not exists analytics_session_id uuid;

grant insert (analytics_session_id)
  on public.service_booking_requests to anon, authenticated;
grant select (analytics_session_id)
  on public.service_booking_requests to authenticated;
