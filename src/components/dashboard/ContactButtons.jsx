import { whatsappLink } from '../../services/format'

// WhatsApp, call and SMS links built from a stored phone number. Renders nothing without a number
// (employees without the contacts permission get phone = null from the database).
export default function ContactButtons({ phone, message }) {
  if (!phone) return <span className="text-xs text-slate-500">No contact access</span>
  const cls = 'rounded-full border border-navy/20 px-3 py-1 text-xs font-medium hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy'
  const tel = phone.length === 10 ? `+91${phone}` : `+${phone}`
  return (
    <span className="flex flex-wrap gap-1.5">
      <a className={cls} href={whatsappLink(phone, message)} target="_blank" rel="noreferrer">WhatsApp</a>
      <a className={cls} href={`tel:${tel}`}>Call</a>
      <a className={cls} href={`sms:${tel}${message ? `?body=${encodeURIComponent(message)}` : ''}`}>SMS</a>
    </span>
  )
}
