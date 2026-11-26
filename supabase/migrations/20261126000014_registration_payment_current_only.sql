-- The account page showed an old registration-fee payment (from a previous registration) on a new registration
-- that had nothing paid yet. Only payments made for the current registration, i.e. after it was sent, count.
create or replace function public.my_registration() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', t.registration_state, 'approval', t.approval_status, 'property_id', t.property_id,
    'stay_type', t.stay_type, 'room_no', t.room_no, 'move_in_date', t.move_in_date, 'checkout_date', t.checkout_date,
    'due_day', t.due_day, 'first_due', public.registration_first_due(t.move_in_date, t.due_day),
    'payment_mode', t.payment_mode, 'payment_status', t.payment_status, 'amount_due', t.amount_due, 'amount_paid', t.amount_paid,
    'coupon_code', t.coupon_code, 'discount', t.discount, 'to_pay', public.registration_balance(t),
    'coupon_description', (select description from public.offers where code = t.coupon_code),
    'payment', (select jsonb_build_object('amount', r.amount, 'status', r.status, 'is_simulated', r.is_simulated, 'paid_at', r.completed_at)
                from public.registration_payments r where r.customer_id = auth.uid()
                  and r.created_at >= coalesce(t.rules_accepted_at, '-infinity'::timestamptz) order by r.claimed_at desc nulls last limit 1),
    'stays', coalesce((select jsonb_agg(s.row_data order by s.guest_id desc) from (
      select distinct on (h.guest_id) h.guest_id,
        coalesce(h.new_row, h.old_row) || jsonb_build_object('removed', h.op = 'DELETE') as row_data
      from public.register_history h
      where coalesce(h.new_row ->> 'customer_id', h.old_row ->> 'customer_id') = auth.uid()::text
      order by h.guest_id desc, h.id desc limit 100
    ) s), '[]'::jsonb))
  from public.tenant_profiles t where t.user_id = auth.uid()
$$;
