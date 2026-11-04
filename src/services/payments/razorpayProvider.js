// Placeholder for Razorpay. Nothing here is wired up yet; see docs/payments.md for the full plan.
//
// To switch on:
//  1. createOrder: call an Edge Function (service role) that creates a Razorpay order and inserts a payments row
//     (provider 'razorpay', status 'created', provider_order_id = order id). Return { paymentId, orderId, keyId }.
//  2. collect: open Razorpay Checkout with that order. The browser's success callback is NOT proof of payment.
//  3. A webhook Edge Function verifies the X-Razorpay-Signature header, then calls
//     apply_payment_result(payment_id, 'succeeded' | 'failed', razorpay_payment_id) with the service role.
//  4. getPaymentStatus() in services/payments/index.js re-reads the payment row, so the UI shows what the
//     database says, whichever provider is used.
export const razorpayProvider = {
  id: 'razorpay',
  label: 'Razorpay',
  isSimulated: false,
  async createOrder() {
    throw new Error('Razorpay is not configured yet. See docs/payments.md')
  },
  async collect() {
    throw new Error('Razorpay is not configured yet. See docs/payments.md')
  },
}
