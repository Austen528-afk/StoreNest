-- Keep editable contact details on the customer profile, separate from auth identifiers.
alter table public.customer_profiles
  add column contact_email text,
  add column contact_phone text;

-- Seed existing profiles from the account's current sign-in details.
update public.customer_profiles as profile
set contact_email = coalesce(profile.contact_email, nullif(auth_user.email, '')),
    contact_phone = coalesce(profile.contact_phone, nullif(auth_user.phone, ''))
from auth.users as auth_user
where auth_user.id = profile.user_id;
