import { useState } from 'react'
import { ActionMsg, FormFields, Modal, useAction, useScope } from './kit'
import { Button } from '../ui'
import { createCoupon } from '../../services/coupons'

// Make a coupon. For an enquiry it is tied to the enquiry's mobile and marks the enquiry approached.
export default function CouponForm({ enquiry, onClose, onDone }) {
  const { property, properties } = useScope()
  const [v, setV] = useState({ code: '', kind: 'flat', value: '', description: '', property_id: enquiry?.property_id || property || properties[0]?.id || '',
    valid_to: '', max_uses: '1', phone: '' })
  const a = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const code = await a.run(() => createCoupon({ ...v, enquiry_id: enquiry?.id ?? '' }), 'Coupon created')
    if (code) onDone({ ...v, code, value: Number(v.value), phone: enquiry?.phone ?? v.phone })
  }
  return (
    <Modal title={enquiry ? `Coupon for ${enquiry.name}` : 'New coupon'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <FormFields value={v} onChange={setV} fields={[
          { key: 'kind', label: 'Discount', type: 'select', required: true, options: [['flat', '₹ off'], ['percent', '% off']] },
          { key: 'value', label: v.kind === 'flat' ? 'Amount off (₹)' : 'Percent off', type: 'number', required: true, min: 1, max: v.kind === 'percent' ? 100 : undefined },
          { key: 'code', label: 'Code (leave empty to make one)' },
          { key: 'description', label: 'Offer text (optional)' },
          { key: 'property_id', label: 'Wing', type: 'select', required: true, options: properties.map((p) => [p.id, p.name]) },
          { key: 'valid_to', label: 'Valid until', type: 'date' },
          { key: 'max_uses', label: 'How many times it can be used', type: 'number', min: 1 },
          ...(enquiry ? [] : [{ key: 'phone', label: 'Only for this mobile (optional)', type: 'tel' }]),
        ]} />
        {enquiry && <p className="text-sm text-slate-600">Only {enquiry.name} ({enquiry.phone}) can use it.</p>}
        <ActionMsg action={a} />
        <Button type="submit" disabled={a.busy}>Create coupon</Button>
      </form>
    </Modal>
  )
}
