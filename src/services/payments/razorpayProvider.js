import { supabase } from '../../lib/supabase'
import { brand } from '../../data/site'

// Razorpay Checkout. The server creates the order (razorpay-create-order) and confirms it
// (razorpay-verify checks the checkout signature; razorpay-webhook is the backstop).
// The browser's success callback is NOT proof of payment; payBill() re-reads the payment row afterwards.
// See docs/payments.md.

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
let loading

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = CHECKOUT_SRC
    s.onload = resolve
    s.onerror = () => { loading = null; reject(new Error('Could not load Razorpay. Check your connection and try again.')) }
    document.head.appendChild(s)
  })
  return loading
}

// supabase.functions.invoke hides the function's own error message inside error.context
async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data
  const detail = await error.context?.json?.().catch(() => null)
  throw new Error(detail?.error || error.message)
}

export const razorpayProvider = {
  id: 'razorpay',
  label: 'Razorpay',
  isSimulated: false,

  async createOrder(bill) {
    const o = await invoke('razorpay-create-order', { billId: bill.id })
    return { ...o, description: bill.description }
  },

  // Resolves when Checkout closes (paid or dismissed). It never rejects for "customer gave up";
  // the payment row simply stays 'created' and the UI reports that.
  async collect(order) {
    await loadCheckout()
    const navy = getComputedStyle(document.documentElement).getPropertyValue('--color-navy').trim()
    await new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount * 100,
        currency: 'INR',
        name: brand.name,
        description: order.description,
        prefill: order.prefill,
        theme: navy ? { color: navy } : undefined,
        handler: async (resp) => {
          try {
            await invoke('razorpay-verify', { paymentId: order.paymentId, ...resp })
          } catch {
            // The webhook will still settle it; the row we read back decides what the customer sees.
          }
          resolve()
        },
        modal: { ondismiss: resolve },
      })
      rzp.open()
    })
  },
}
