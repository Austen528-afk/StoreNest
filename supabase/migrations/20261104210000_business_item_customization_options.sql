-- Store per-item flavour, sauce, chilli and extra selections.
-- Empty arrays retain existing behaviour for all previously published items.
alter table public.business_items
  add column if not exists customization_options jsonb not null default '[]'::jsonb;

alter table public.business_items
  drop constraint if exists business_items_customization_options_is_array;

alter table public.business_items
  add constraint business_items_customization_options_is_array
  check (jsonb_typeof(customization_options) = 'array');

comment on column public.business_items.customization_options is
  'Editable product option groups (name, selection, required, max, choices with additional prices).';
