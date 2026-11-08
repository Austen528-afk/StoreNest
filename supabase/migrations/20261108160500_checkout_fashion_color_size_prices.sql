-- Keep checkout validation in sync with fashion colour-set sizes and prices.
-- Price/option validity is established from business_items, not browser-submitted prices.
-- Existing non-fashion products and legacy size options retain their behavior.
CREATE OR REPLACE FUNCTION public.prepare_storefront_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_line jsonb; v_product public.business_items%rowtype; v_group jsonb; v_option jsonb; v_choice jsonb;
  v_choice_id text; v_group_id text; v_group_selection text; v_group_values jsonb; v_customizations jsonb;
  v_selection jsonb; v_selected_values jsonb; v_snapshot jsonb := '[]'::jsonb;
  v_item_count integer := 0; v_quantity integer; v_choice_count integer; v_group_max integer;
  v_group_required boolean; v_extra numeric; v_unit_price numeric; v_line_total numeric; v_subtotal numeric := 0; v_note text;
  v_fashion_sets jsonb; v_fashion_color jsonb; v_fashion_sizes jsonb; v_fashion_size jsonb;
  v_color_ids jsonb; v_size_ids jsonb; v_color_id text; v_size_id text;
  v_fashion_enabled boolean; v_own_fashion_sizes boolean;
  v_fixed_price numeric; v_additional_price numeric;
begin
  new.customer_name := btrim(coalesce(new.customer_name, ''));
  new.contact_phone := btrim(coalesce(new.contact_phone, ''));
  new.contact_email := nullif(btrim(coalesce(new.contact_email, '')), '');
  if char_length(new.customer_name) not between 2 and 100 then raise exception 'Enter a valid customer name.'; end if;
  if char_length(new.contact_phone) not between 7 and 40 then raise exception 'Enter a valid phone number.'; end if;
  if new.payment_method not in ('pay_on_collection','card') then raise exception 'Choose a valid payment method.'; end if;
  if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) < 1 or jsonb_array_length(new.items) > 50 then
    raise exception 'Your basket is empty or contains too many items.';
  end if;
  if not exists (select 1 from public.businesses b where b.id = new.business_id and b.is_published = true) then
    raise exception 'This store is unavailable for ordering.';
  end if;
  for v_line in select entry.value from jsonb_array_elements(new.items) as entry(value) loop
    v_item_count := v_item_count + 1;
    if jsonb_typeof(v_line) <> 'object' then raise exception 'An item in this order is invalid.'; end if;
    begin
      v_product.id := (v_line->>'item_id')::uuid;
      v_quantity := (v_line->>'quantity')::integer;
    exception when others then raise exception 'An item or quantity is invalid.';
    end;
    if v_quantity is null or v_quantity < 1 or v_quantity > 50 then raise exception 'Each item quantity must be between 1 and 50.'; end if;
    select bi.* into v_product from public.business_items bi
      where bi.id = v_product.id and bi.business_id = new.business_id and bi.item_type = 'product' and bi.is_available = true;
    if not found then raise exception 'An item is no longer available.'; end if;
    v_selection := coalesce(v_line->'selection', '{}'::jsonb);
    if jsonb_typeof(v_selection) <> 'object' then raise exception 'Item choices are invalid.'; end if;

    -- Fashion colour sets are stored independently of the legacy customization groups.
    -- Determine the colour and its own allowed sizes from the persisted product record.
    v_fashion_sets := coalesce(v_product.fashion_color_sets, '[]'::jsonb);
    v_fashion_enabled := case when jsonb_typeof(v_fashion_sets) = 'array'
      then jsonb_array_length(v_fashion_sets) > 0 else false end;
    v_fashion_color := null;
    v_fashion_size := null;
    v_own_fashion_sizes := false;
    v_fixed_price := null;
    v_additional_price := 0;

    if v_fashion_enabled then
      v_color_ids := coalesce(v_selection->'fashion-color', '[]'::jsonb);
      if jsonb_typeof(v_color_ids) <> 'array' then
        raise exception 'Choose an available clothing colour.';
      end if;
      if jsonb_array_length(v_color_ids) > 1 then
        raise exception 'Choose only one clothing colour.';
      end if;
      if jsonb_array_length(v_color_ids) = 1 then
        if jsonb_typeof(v_color_ids->0) <> 'string' then
          raise exception 'Choose an available clothing colour.';
        end if;
        v_color_id := v_color_ids->>0;
        select colour.value into v_fashion_color
        from jsonb_array_elements(v_fashion_sets) as colour(value)
        where colour.value->>'id' = v_color_id limit 1;
        if not found then raise exception 'The selected clothing colour is no longer available.'; end if;
      else
        if jsonb_array_length(v_fashion_sets) > 1 then
          raise exception 'Choose a clothing colour.';
        end if;
        v_fashion_color := v_fashion_sets->0;
      end if;

      v_fashion_sizes := case when jsonb_typeof(v_fashion_color->'sizes') = 'array'
        then v_fashion_color->'sizes' else '[]'::jsonb end;
      v_own_fashion_sizes := jsonb_array_length(v_fashion_sizes) > 0;
      if v_own_fashion_sizes then
        v_size_ids := coalesce(v_selection->'fashion-size', '[]'::jsonb);
        if jsonb_typeof(v_size_ids) <> 'array' then raise exception 'Choose an available clothing size.'; end if;
        if jsonb_array_length(v_size_ids) <> 1 then raise exception 'Choose one clothing size.'; end if;
        if jsonb_typeof(v_size_ids->0) <> 'string' then raise exception 'Choose an available clothing size.'; end if;
        v_size_id := v_size_ids->>0;
        select size_option.value into v_fashion_size
        from jsonb_array_elements(v_fashion_sizes) as size_option(value)
        where size_option.value->>'id' = v_size_id limit 1;
        if not found then
          raise exception 'That size is not available in the selected clothing colour.';
        end if;
      end if;
    end if;
    for v_group_id in select keys.key from jsonb_object_keys(v_selection) as keys(key) loop
      if not (
        v_fashion_enabled and (v_group_id = 'fashion-color' or (v_own_fashion_sizes and v_group_id = 'fashion-size'))
      ) and not exists (
        select 1 from jsonb_array_elements(coalesce(v_product.customization_options,'[]'::jsonb)) as cfg(value)
        where cfg.value->>'id' = v_group_id
      ) then
        raise exception 'An item choice is no longer available.';
      end if;
    end loop;
    v_unit_price := v_product.price;
    v_customizations := '[]'::jsonb;
    if v_fashion_enabled then
      if nullif(btrim(v_fashion_color->>'price'), '') is not null then
        v_unit_price := (v_fashion_color->>'price')::numeric;
      end if;
      if v_own_fashion_sizes and nullif(btrim(v_fashion_size->>'price'), '') is not null then
        v_fixed_price := (v_fashion_size->>'price')::numeric;
      end if;
      if v_unit_price < 0 or (v_fixed_price is not null and v_fixed_price < 0) then
        raise exception 'Clothing variant price is invalid.';
      end if;
      v_customizations := v_customizations || jsonb_build_array(jsonb_build_object(
        'group', 'Colour', 'values', jsonb_build_array(
          coalesce(nullif(btrim(v_fashion_color->>'name'), ''), 'Colour 1')
        )
      ));
      if v_own_fashion_sizes then
        v_customizations := v_customizations || jsonb_build_array(jsonb_build_object(
          'group', 'Size', 'values', jsonb_build_array(v_fashion_size->>'name')
        ));
      end if;
    end if;
    for v_group in select cfg.value from jsonb_array_elements(coalesce(v_product.customization_options,'[]'::jsonb)) as cfg(value) loop
      v_group_id := coalesce(v_group->>'id', '');
      -- Avoid charging or validating legacy groups twice. Size-specific options
      -- come from the selected colour, while older products may still use legacy sizes.
      if v_fashion_enabled and (v_group_id = 'fashion-color' or (v_own_fashion_sizes and v_group_id = 'fashion-size')) then
        continue;
      end if;
      v_group_selection := coalesce(v_group->>'selection', 'single');
      v_group_required := coalesce((v_group->>'required')::boolean, false);
      v_group_max := greatest(1, least(coalesce((v_group->>'max')::integer, 1), 12));
      v_selected_values := coalesce(v_selection->v_group_id, '[]'::jsonb);
      if jsonb_typeof(v_selected_values) <> 'array' then raise exception 'Item choices are invalid.'; end if;
      if v_group_selection not in ('single','multiple','scale') then raise exception 'An item choice group is invalid.'; end if;
      v_choice_count := jsonb_array_length(v_selected_values);
      if v_group_required and v_choice_count = 0 then raise exception 'Choose all required item options.'; end if;
      if v_group_selection in ('single','scale') and v_choice_count > 1 then raise exception 'Choose only one level for each scale.'; end if;
      if v_group_selection = 'multiple' and v_choice_count > v_group_max then raise exception 'Too many options were selected.'; end if;
      v_group_values := '[]'::jsonb;
      for v_choice in select choices.value from jsonb_array_elements(v_selected_values) as choices(value) loop
        if jsonb_typeof(v_choice) <> 'string' then raise exception 'An item choice is invalid.'; end if;
        v_choice_id := v_choice #>> '{}';
        select options.value into v_option from jsonb_array_elements(coalesce(v_group->'options','[]'::jsonb)) as options(value)
          where options.value->>'id' = v_choice_id;
        if not found then raise exception 'A selected item option is no longer available.'; end if;
        v_extra := coalesce((v_option->>'price')::numeric, 0);
        if v_extra < 0 then raise exception 'An item option has an invalid price.'; end if;
        if coalesce(v_group->>'priceMode','additional') = 'fixed' and v_group_selection = 'single' then
          v_fixed_price := v_extra;
        else
          v_additional_price := v_additional_price + v_extra;
        end if;
        v_group_values := v_group_values || jsonb_build_array(v_option->>'name');
      end loop;
      if v_choice_count > 0 then
        v_customizations := v_customizations || jsonb_build_array(jsonb_build_object('group', v_group->>'name', 'values', v_group_values));
      end if;
    end loop;
    -- The unit price is computed on the server, never taken from basket JSON.
    -- A fixed size price replaces the base; independent extras are added once.
    v_unit_price := round(coalesce(v_fixed_price, v_unit_price) + v_additional_price, 2);
    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_note := left(btrim(coalesce(v_line->>'note','')), 200);
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'item_id', v_product.id, 'name', v_product.name, 'image_url', v_product.image_url,
      'media_urls', v_product.media_urls, 'quantity', v_quantity, 'unit_price', v_unit_price,
      'line_total', v_line_total, 'customizations', v_customizations, 'note', nullif(v_note, '')
    ));
  end loop;
  if v_item_count < 1 then raise exception 'Your basket is empty.'; end if;
  new.items := v_snapshot;
  new.subtotal := round(v_subtotal, 2);
  new.status := 'new';
  new.payment_status := case when new.payment_method = 'card' then 'pending' else 'unpaid' end;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$function$
