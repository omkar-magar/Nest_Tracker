import { supabase } from '../../lib/supabase'

// DEMO provider: simulated money only. It talks to the demo_* database functions, which refuse to run
// when app_settings.demo_payments_enabled is false (switch it off before taking real payments).
export const demoProvider = {
  id: 'demo',
  label: 'Demo payment (no real money)',
  isSimulated: true,

  // Asks the backend for a payment row in status "created". Nothing is paid yet.
  async createOrder(bill) {
    const { data, error } = await supabase.rpc('payment_create_order', { p_bill_id: bill.id, p_provider: 'demo' })
    if (error) throw error
    return { paymentId: data, amount: bill.amount }
  },

  // The "gateway" step. For the demo, the user picks the outcome; the backend records it.
  // ui.chooseOutcome() resolves to 'success' or 'failure'.
  async collect(order, ui) {
    const outcome = await ui.chooseOutcome()
    const { error } = await supabase.rpc('demo_complete_payment', { p_payment_id: order.paymentId, p_outcome: outcome })
    if (error) throw error
  },
}
