import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Badge, Button, ErrorBox, Field, TableSkeleton, inputCls } from '../ui'
import useAsync from '../../hooks/useAsync'
import { label } from '../../services/pg'

// ---------------------------------------------------------------- property scope (owner switches property; '' = all)
const ScopeContext = createContext({ property: '', setProperty: () => {}, properties: [] })
export const useScope = () => useContext(ScopeContext)
export function ScopeProvider({ properties, children }) {
  const [property, setPropertyState] = useState(() => {
    try { return localStorage.getItem('yolo.property') ?? '' } catch { return '' }
  })
  const valid = property === '' || properties.some((p) => p.id === property) ? property : ''
  const setProperty = (p) => {
    setPropertyState(p)
    try { localStorage.setItem('yolo.property', p) } catch { /* private mode: keep it for this visit only */ }
  }
  return <ScopeContext.Provider value={{ property: valid, setProperty, properties }}>{children}</ScopeContext.Provider>
}

// ---------------------------------------------------------------- async helpers
// Loads data and renders loading / error / content.
export function Load({ loader, deps = [], children }) {
  const s = useAsync(loader, deps)
  if (s.loading) return <TableSkeleton />
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />
  return children(s.data, s.reload)
}

// Runs an action, keeps busy / error / message state.
export function useAction() {
  const [state, setState] = useState({ busy: false, error: '', msg: '' })
  const run = useCallback(async (fn, okMsg = '') => {
    setState({ busy: true, error: '', msg: '' })
    try {
      const r = await fn()
      setState({ busy: false, error: '', msg: okMsg })
      return r ?? true
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), msg: '' })
      return undefined
    }
  }, [])
  return { ...state, run, clear: () => setState({ busy: false, error: '', msg: '' }) }
}

export function ActionMsg({ action }) {
  if (action.error) return <p role="alert" className="text-sm text-red-700">{action.error}</p>
  if (action.msg) return <p role="status" className="text-sm text-green-800">{action.msg}</p>
  return null
}

// ---------------------------------------------------------------- modal
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('keydown', esc); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-2 sm:items-center sm:p-4" role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white p-5 text-navy outline-none ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-xl leading-none text-slate-500 hover:text-navy focus-visible:outline-2 focus-visible:outline-navy">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- tabs inside a page
export function Tabs({ tabs, tab, onTab, label: name = 'Sections' }) {
  return (
    <div role="tablist" aria-label={name} className="mb-5 flex gap-1 overflow-x-auto border-b border-navy/10">
      {tabs.map(([key, text]) => (
        <button key={key} role="tab" aria-selected={tab === key} onClick={() => onTab(key)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${tab === key ? 'border-gold text-navy' : 'border-transparent text-slate-600 hover:text-navy'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- generic form fields
// field: { key, label, type: text|number|date|datetime-local|email|tel|textarea|select|checkbox, options, required, help, span }
export function FormFields({ fields, value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.filter((f) => !f.hidden?.(value)).map((f) => {
        const v = value[f.key] ?? (f.type === 'checkbox' ? false : '')
        const common = { id: `f-${f.key}`, required: f.required, disabled: f.disabled }
        let input
        if (f.type === 'textarea') input = <textarea {...common} rows={f.rows || 3} className={inputCls} value={v} onChange={(e) => set(f.key, e.target.value)} />
        else if (f.type === 'select') {
          input = (
            <select {...common} className={inputCls} value={v} onChange={(e) => set(f.key, e.target.value)}>
              {!f.required && <option value="">{f.placeholder || '—'}</option>}
              {f.options.map((o) => {
                const [val, text] = Array.isArray(o) ? o : [o, label(o)]
                return <option key={val} value={val}>{text}</option>
              })}
            </select>
          )
        } else if (f.type === 'checkbox') {
          return (
            <label key={f.key} className={`flex items-center gap-2 text-sm font-medium text-navy ${f.span ? 'sm:col-span-2' : ''}`}>
              <input type="checkbox" className="h-4 w-4 accent-navy" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />
              {f.label}
            </label>
          )
        } else {
          input = <input {...common} type={f.type || 'text'} className={inputCls} value={v} min={f.min} max={f.max} step={f.step}
            inputMode={f.type === 'tel' ? 'tel' : undefined} onChange={(e) => set(f.key, e.target.value)} />
        }
        return (
          <div key={f.key} className={f.span || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            <Field label={`${f.label}${f.required ? ' *' : ''}`}>{input}</Field>
            {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
          </div>
        )
      })}
    </div>
  )
}

// Converts form strings to the types a table column expects.
export function coerce(fields, value) {
  const out = {}
  for (const f of fields) {
    if (!(f.key in value) || f.readOnly) continue
    let v = value[f.key]
    if (f.type === 'number') v = v === '' || v === null ? null : Number(v)
    else if (f.type === 'checkbox') v = Boolean(v)
    else if (f.type === 'list') v = String(v || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (v === '' && !f.keepEmpty) v = null
    out[f.key] = v
  }
  return out
}

// ---------------------------------------------------------------- buttons
export function FileButton({ label: text = 'Upload', accept = 'image/jpeg,image/png,image/webp,application/pdf', onFile, busy, capture, multiple }) {
  return (
    <label className={`inline-flex cursor-pointer items-center rounded-full border border-navy/30 px-4 py-1.5 text-sm font-semibold text-navy hover:bg-navy/5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy ${busy ? 'pointer-events-none opacity-50' : ''}`}>
      {busy ? 'Uploading…' : text}
      <input type="file" className="sr-only" accept={accept} capture={capture} multiple={multiple} disabled={busy}
        onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFile(multiple ? files : files[0]) }} />
    </label>
  )
}

export const Small = (props) => <Button variant="outline" className="!px-3 !py-1 text-xs" {...props} />

export function StatusBadge({ value, tones = {} }) {
  const fallback = { active: 'green', paid: 'green', approved: 'green', verified: 'green', resolved: 'green', closed: 'gray', booked: 'green',
    pending: 'amber', new: 'amber', assigned: 'amber', in_progress: 'amber', partially_paid: 'amber', held: 'navy', scheduled: 'amber',
    overdue: 'red', rejected: 'red', lost: 'red', urgent: 'red', high: 'red', failed: 'red', hot: 'red', warm: 'amber', cold: 'gray' }
  return <Badge tone={tones[value] ?? fallback[value] ?? 'gray'}>{label(value)}</Badge>
}

// A labelled read-only fact
export const Fact = ({ k, children }) => (
  <div><dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt><dd className="text-sm font-medium">{children ?? '—'}</dd></div>
)

export const H3 = ({ children, action }) => (
  <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2 first:mt-0">
    <h3 className="text-lg font-bold">{children}</h3>{action}
  </div>
)
