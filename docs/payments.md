# Payments

## Design
`src/services/payments/index.js` exposes `payBill(bill, ui)`: `createOrder` -> `collect` -> read the payment row back from the database. Providers implement `{ id, label, isSimulated, createOrder, collect }`. UI and billing code never mention a gateway.

The browser can never mark anything paid. Only `apply_payment_result()` does, and it is revoked from `anon`/`authenticated` (service role only). It is idempotent, and a unique index allows one succeeded payment per bill.

## Demo provider (default)
`payment_create_order` creates a `created` payment (`is_simulated = true`). `demo_complete_payment(payment_id, 'success'|'failure')` runs the result through `apply_payment_result`. It checks the caller owns the payment and `app_settings.demo_payments_enabled`. Demo payments are labelled "Demo" in every table and excluded from the admin "received (real)" total.
**Before real launch:** `update app_settings set value = 'false' where key = 'demo_payments_enabled';`

## Razorpay (wired up)
Flow: `razorpay-create-order` -> Checkout -> `razorpay-verify` -> `getPaymentStatus` reads the row back. `razorpay-webhook` is the backstop if the customer closes the tab.

| Function | Auth | Role |
|---|---|---|
| `razorpay-create-order` | customer JWT | Loads the caller's unpaid bill (amount from the DB), creates the Razorpay order, inserts the `payments` row (`provider='razorpay'`, `provider_order_id`). Returns `{ paymentId, orderId, keyId, amount, prefill }`. |
| `razorpay-verify` | customer JWT | Recomputes the checkout signature (`HMAC_SHA256(order_id\|payment_id, key_secret)`), then `apply_payment_result`. |
| `razorpay-webhook` | none (`verify_jwt = false`), HMAC of the raw body | On `payment.captured` / `order.paid`: checks the amount, then `apply_payment_result`. `payment.failed` is ignored on purpose: Checkout allows retries on the same order, and a payment marked failed is final. Abandoned payments stay `created`. |

### Go live
1. Razorpay dashboard: get the Key Id and Key Secret (start with Test mode keys, `rzp_test_...`).
2. Set secrets (never in `.env.local` or any `VITE_` variable):
   `supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=...`
3. Deploy: `supabase functions deploy razorpay-create-order razorpay-verify razorpay-webhook` (the webhook's `verify_jwt = false` comes from `supabase/config.toml`).
4. Razorpay dashboard > Webhooks: URL `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`, events `payment.captured` and `order.paid`, secret = `RAZORPAY_WEBHOOK_SECRET`.
5. Frontend env (Vercel and `.env.local`): `VITE_PAYMENT_PROVIDER=razorpay`, then redeploy.
6. Turn off demo payments: `update app_settings set value = 'false' where key = 'demo_payments_enabled';`
7. Test with Razorpay test cards/UPI, then swap in Live keys and update the secrets and webhook.
