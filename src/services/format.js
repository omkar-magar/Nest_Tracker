export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

export const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

// Digits only, with India's country code when the number is a bare 10-digit mobile.
export function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

export const whatsappLink = (phone, text = '') =>
  `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
