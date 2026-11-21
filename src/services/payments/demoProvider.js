import { supabase } from '../../lib/supabase'

// DEMO provider: simulated money only. It talks to the demo_* database functions, which refuse to run
// when app_settings.demo_payments_enabled is false (switch it off before taking real payments).
export const demoProvider = {
  id: 'demo',
  label: 'Demo payment (no real money)',
  isSimulated: true,

  // Asks the backend for a payment row in status "created". Nothing is paid yet.
  // amount: only for a part payment; without it the backend charges everything still owed.
  async createOrder(bill, amount) {
    const args = { p_bill_id: bill.id, p_provider: 'demo' }
    if (amount) args.p_amount = amount
    const { data, error } = await supabase.rpc('payment_create_order', args)
    if (error) throw error
    return { paymentId: data, amount: amount || bill.amount - (bill.amount_paid || 0) }
  },

  // The "gateway" step. For the demo, the user picks the outcome; the backend records it.
  // ui.chooseOutcome() resolves to 'success' or 'failure'.
  async collect(order, ui) {
    const outcome = await ui.chooseOutcome()
    const { error } = await supabase.rpc('demo_complete_payment', { p_payment_id: order.paymentId, p_outcome: outcome })
    if (error) throw error
  },
}
