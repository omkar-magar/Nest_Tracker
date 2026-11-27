import { supabase } from '../../lib/supabase'
import { demoProvider } from './demoProvider'
import { razorpayProvider } from './razorpayProvider'

// Booking and billing code only ever calls payBill(). To change gateway, change VITE_PAYMENT_PROVIDER.
const providers = { demo: demoProvider, razorpay: razorpayProvider }

export const paymentProvider = providers[import.meta.env.VITE_PAYMENT_PROVIDER || 'demo'] ?? demoProvider

// What the database says about a payment. The UI's result message is built from this row, never from
// whatever the provider's client-side callback claimed.
async function getPaymentStatus(paymentId) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, status, failure_reason, is_simulated')
    .eq('id', paymentId)
    .single()
  if (error) throw error
  return data
}

// The registration payment through the real gateway. Like payBill, the result is read back from the database.
export async function payRegistration(ui) {
  const order = await paymentProvider.createRegistrationOrder()
  await paymentProvider.collect(order, ui)
  const { data, error } = await supabase
    .from('registration_payments')
    .select('id, status, amount, is_simulated')
    .eq('id', order.paymentId)
    .single()
  if (error) throw error
  return data
}

// amount: a part payment (less than what is owed); leave it out to pay in full
export async function payBill(bill, ui, amount) {
  const order = await paymentProvider.createOrder(bill, amount)
  await paymentProvider.collect(order, ui)
  return getPaymentStatus(order.paymentId)
}
