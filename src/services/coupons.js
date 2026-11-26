import { rpc } from './manage'
import { rupees, whatsappLink } from './format'

// Coupons (the offers table): managers and the owner make them, guests apply them on the registration payment.
export const couponsList = () => rpc('coupons_list')
export const createCoupon = (p) => rpc('create_coupon', { p })
export const setCouponActive = (code, active) => rpc('set_coupon_active', { p_code: code, p_active: active })
export const applyCoupon = (code) => rpc('apply_registration_coupon', { p_code: code })
export const removeCoupon = () => rpc('remove_registration_coupon')

export const couponValue = (c) => (c.kind === 'flat' ? `${rupees(Number(c.value))} off` : `${Number(c.value)}% off`)
export function couponMessage(c, { name, site = window.location.origin } = {}) {
  const extra = c.description && c.description !== couponValue(c) ? ` (${c.description})` : ''
  return `${name ? `Hi ${name}, ` : ''}here is an exclusive YOLO Nest offer: ${couponValue(c)}${extra}.`
    + ` Use code ${c.code} when you pay for your registration${c.valid_to ? ` before ${c.valid_to}` : ''}. Register here: ${site}/signup`
}
export const couponWhatsapp = (c, opts = {}) => whatsappLink(c.phone || opts.phone || '', couponMessage(c, opts))
