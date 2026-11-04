# Payments

## Design
`src/services/payments/index.js` exposes `payBill(bill, ui)`: `createOrder` -> `collect` -> read the payment row back from the database. Providers implement `{ id, label, isSimulated, createOrder, collect }`. UI and billing code never mention a gateway.

The browser can never mark anything paid. Only `apply_payment_result()` does, and it is revoked from `anon`/`authenticated` (service role only). It is idempotent, and a unique index allows one succeeded payment per bill.

## Demo provider (default)
`payment_create_order` creates a `created` payment (`is_simulated = true`). `demo_complete_payment(payment_id, 'success'|'failure')` runs the result through `apply_payment_result`. It checks the caller owns the payment and `app_settings.demo_payments_enabled`. Demo payments are labelled "Demo" in every table and excluded from the admin "received (real)" total.
**Before real launch:** `update app_settings set value = 'false' where key = 'demo_payments_enabled';`

## Adding Razorpay
1. Edge Function `razorpay-create-order` (service role): verify the caller, load their unpaid bill, create the Razorpay order for `bill.amount`, insert `payments` (`provider='razorpay'`, `provider_order_id`), return `{ paymentId, orderId, keyId }`. Secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
2. Fill `razorpayProvider.createOrder` (call the function) and `collect` (open Checkout). Set `VITE_PAYMENT_PROVIDER=razorpay`.
3. Edge Function `razorpay-webhook`: verify `X-Razorpay-Signature` (HMAC of the raw body with the webhook secret), find the payment by `provider_order_id`, call `apply_payment_result(id, 'succeeded'|'failed', razorpay_payment_id)`. Optionally also verify the checkout signature server-side.
4. Check `provider = 'razorpay'` is allowed in `payment_create_order` for the function path, or insert from the function directly (as above). Booking, bills and dashboards need no change.
