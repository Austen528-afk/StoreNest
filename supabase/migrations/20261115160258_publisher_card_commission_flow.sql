-- Card payment commission recording.
-- A card commission is earned only for paid, completed orders, after the
-- corresponding StoreNest platform fee has been marked collected.
ALTER TABLE private.publisher_commission_test_transactions
  DROP CONSTRAINT IF EXISTS publisher_commission_test_transactions_payment_method_check;

ALTER TABLE private.publisher_commission_test_transactions
  ADD CONSTRAINT publisher_commission_test_transactions_payment_method_check
  CHECK (payment_method = ANY (ARRAY['pay_on_collection'::text, 'card'::text]));

CREATE OR REPLACE FUNCTION private.record_test_publisher_commission(p_test_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_test private.publisher_commission_test_transactions%rowtype;
  v_fee_obligation_id uuid;
  v_fee_amount numeric(12,2);
  v_commission_amount numeric(12,2);
  v_fee_status text;
  v_amount_collected numeric(12,2);
  v_commission_status text;
  v_earned_at timestamp with time zone;
BEGIN
  SELECT * INTO v_test
  FROM private.publisher_commission_test_transactions AS test_row
  WHERE test_row.id = p_test_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test transaction not found.' USING errcode = 'P0002';
  END IF;

  IF v_test.is_test IS DISTINCT FROM true
     OR v_test.payment_method NOT IN ('pay_on_collection', 'card')
     OR v_test.order_status IS DISTINCT FROM 'completed'
     OR v_test.payment_status IS DISTINCT FROM 'paid'
     OR v_test.collected_at IS NULL
     OR v_test.payment_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'A test commission can be recorded only after a completed, paid test order.' USING errcode = '22023';
  END IF;

  v_fee_amount := pg_catalog.round(v_test.order_amount * v_test.platform_fee_rate, 2);
  v_commission_amount := pg_catalog.round(v_fee_amount * v_test.publisher_commission_rate, 2);
  v_fee_status := CASE WHEN v_test.payment_method = 'card' THEN 'collected' ELSE 'outstanding' END;
  v_amount_collected := CASE WHEN v_test.payment_method = 'card' THEN v_fee_amount ELSE 0 END;
  v_commission_status := CASE WHEN v_test.payment_method = 'card' THEN 'earned' ELSE 'pending' END;
  v_earned_at := CASE
    WHEN v_test.payment_method = 'card' THEN COALESCE(v_test.payment_confirmed_at, pg_catalog.now())
    ELSE NULL
  END;

  INSERT INTO private.platform_fee_obligations (
    source_order_id, source_test_transaction_id, business_owner_user_id, business_id,
    publisher_id, business_name_snapshot, order_amount, platform_fee_rate,
    platform_fee_amount, amount_collected, fee_status, is_test
  )
  VALUES (
    NULL, v_test.id, v_test.business_owner_user_id, v_test.business_id,
    v_test.publisher_id, v_test.business_name_snapshot, v_test.order_amount,
    v_test.platform_fee_rate, v_fee_amount, v_amount_collected, v_fee_status, true
  )
  ON CONFLICT DO NOTHING;

  SELECT fee.id INTO v_fee_obligation_id
  FROM private.platform_fee_obligations AS fee
  WHERE fee.source_test_transaction_id = v_test.id;

  INSERT INTO private.publisher_commissions (
    platform_fee_obligation_id, source_order_id, source_test_transaction_id,
    publisher_id, business_owner_user_id, business_id, business_name_snapshot,
    payment_method, commission_rate, commission_amount, status, is_test, earned_at
  )
  VALUES (
    v_fee_obligation_id, NULL, v_test.id, v_test.publisher_id,
    v_test.business_owner_user_id, v_test.business_id, v_test.business_name_snapshot,
    v_test.payment_method, v_test.publisher_commission_rate, v_commission_amount,
    v_commission_status, true, v_earned_at
  )
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_storefront_order_publisher_commission(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_business_owner_user_id uuid;
  v_publisher_id uuid;
  v_business_name text;
  v_order_amount numeric(12,2);
  v_payment_method text;
  v_payment_status text;
  v_order_status text;
  v_fee_rate numeric(5,4) := 0.0500;
  v_commission_rate numeric(5,4) := 0.1500;
  v_fee_amount numeric(12,2);
  v_commission_amount numeric(12,2);
  v_fee_obligation_id uuid;
  v_amount_collected numeric(12,2);
  v_fee_status text;
  v_commission_status text;
  v_earned_at timestamp with time zone;
BEGIN
  SELECT order_row.business_id,
         business_row.owner_id,
         owner_profile.referred_by_publisher_id,
         business_row.name,
         order_row.subtotal,
         order_row.payment_method,
         order_row.payment_status,
         order_row.status
    INTO v_business_id,
         v_business_owner_user_id,
         v_publisher_id,
         v_business_name,
         v_order_amount,
         v_payment_method,
         v_payment_status,
         v_order_status
  FROM public.storefront_orders AS order_row
  JOIN public.businesses AS business_row ON business_row.id = order_row.business_id
  LEFT JOIN public.business_owner_profiles AS owner_profile
    ON owner_profile.user_id = business_row.owner_id
  WHERE order_row.id = p_order_id
  FOR UPDATE OF order_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found while recording the Publisher commission.' USING errcode = 'P0002';
  END IF;

  IF v_payment_method NOT IN ('pay_on_collection', 'card')
     OR v_payment_status IS DISTINCT FROM 'paid'
     OR v_order_status IS DISTINCT FROM 'completed'
     OR v_publisher_id IS NULL THEN
    RETURN;
  END IF;

  IF v_order_amount IS NULL OR v_order_amount <= 0 THEN
    RETURN;
  END IF;

  v_order_amount := pg_catalog.round(v_order_amount, 2);
  v_fee_amount := pg_catalog.round(v_order_amount * v_fee_rate, 2);
  IF v_fee_amount <= 0 THEN
    RETURN;
  END IF;

  v_commission_amount := pg_catalog.round(v_fee_amount * v_commission_rate, 2);
  v_business_name := COALESCE(NULLIF(pg_catalog.btrim(v_business_name), ''), 'Referred business');
  v_fee_status := CASE WHEN v_payment_method = 'card' THEN 'collected' ELSE 'outstanding' END;
  v_amount_collected := CASE WHEN v_payment_method = 'card' THEN v_fee_amount ELSE 0 END;
  v_commission_status := CASE WHEN v_payment_method = 'card' THEN 'earned' ELSE 'pending' END;
  v_earned_at := CASE WHEN v_payment_method = 'card' THEN pg_catalog.now() ELSE NULL END;

  INSERT INTO private.platform_fee_obligations (
    source_order_id, source_test_transaction_id, business_owner_user_id, business_id,
    publisher_id, business_name_snapshot, order_amount, platform_fee_rate,
    platform_fee_amount, amount_collected, fee_status, is_test
  )
  VALUES (
    p_order_id, NULL, v_business_owner_user_id, v_business_id, v_publisher_id,
    v_business_name, v_order_amount, v_fee_rate, v_fee_amount, v_amount_collected,
    v_fee_status, false
  )
  ON CONFLICT DO NOTHING;

  SELECT fee.id INTO v_fee_obligation_id
  FROM private.platform_fee_obligations AS fee
  WHERE fee.source_order_id = p_order_id;

  INSERT INTO private.publisher_commissions (
    platform_fee_obligation_id, source_order_id, source_test_transaction_id,
    publisher_id, business_owner_user_id, business_id, business_name_snapshot,
    payment_method, commission_rate, commission_amount, status, is_test, earned_at
  )
  VALUES (
    v_fee_obligation_id, p_order_id, NULL, v_publisher_id,
    v_business_owner_user_id, v_business_id, v_business_name, v_payment_method,
    v_commission_rate, v_commission_amount, v_commission_status, false, v_earned_at
  )
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_completed_card_order_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.payment_method = 'card'
     AND NEW.payment_status = 'paid'
     AND NEW.status = 'completed'
     AND (
       OLD.payment_status IS DISTINCT FROM NEW.payment_status
       OR OLD.status IS DISTINCT FROM NEW.status
     ) THEN
    PERFORM private.record_storefront_order_publisher_commission(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS storefront_card_commission_on_confirmation
  ON public.storefront_orders;

CREATE TRIGGER storefront_card_commission_on_confirmation
AFTER UPDATE OF payment_status, status
ON public.storefront_orders
FOR EACH ROW
WHEN (
  NEW.payment_method = 'card'
  AND NEW.payment_status = 'paid'
  AND NEW.status = 'completed'
  AND (
    OLD.payment_status IS DISTINCT FROM NEW.payment_status
    OR OLD.status IS DISTINCT FROM NEW.status
  )
)
EXECUTE FUNCTION private.record_completed_card_order_financials();

REVOKE ALL ON FUNCTION private.record_completed_card_order_financials() FROM PUBLIC, anon, authenticated;
