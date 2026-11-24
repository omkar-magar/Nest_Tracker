import { FormFields } from './kit'
import { RULES, TENANT_SECTIONS } from './tenantFields'
import { Field, inputCls } from '../ui'

// The paper Resident Registration Form on screen: sections 1-5, then the rules (6) with the sign-off.
// `skip` hides fields the page already asks elsewhere (e.g. name and phone on the account page).
export default function ResidentForm({ value, onChange, skip = [], signed = false }) {
  return (
    <div className="space-y-6">
      {TENANT_SECTIONS.map((s) => {
        const fields = s.fields.filter((f) => !skip.includes(f.key))
        return fields.length === 0 ? null : (
          <section key={s.title} aria-label={s.title}>
            <h3 className="mb-3 rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white">{s.title}</h3>
            <FormFields fields={fields} value={value} onChange={onChange} />
          </section>
        )
      })}
      <section aria-label="6. Rules and regulations">
        <h3 className="mb-3 rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white">6. Rules &amp; regulations</h3>
        <ol className="space-y-2 rounded-2xl border border-navy/10 bg-cream p-4 text-sm">
          {RULES.map(([title, text], i) => <li key={title}><span className="font-semibold">{i + 1}. {title}.</span> {text}</li>)}
        </ol>
        {signed ? <p className="mt-3 text-sm">Rules accepted and signed.</p> : (
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-2 text-sm font-medium">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy" checked={Boolean(value.rules_accepted)} onChange={(e) => onChange({ ...value, rules_accepted: e.target.checked })} />
              I have read, understood, and agree to comply with all the above rules &amp; regulations.
            </label>
            <Field label="Resident signature (type your full name)">
              <input className={inputCls} value={value.rules_signature ?? ''} onChange={(e) => onChange({ ...value, rules_signature: e.target.value })} />
            </Field>
          </div>
        )}
      </section>
    </div>
  )
}
