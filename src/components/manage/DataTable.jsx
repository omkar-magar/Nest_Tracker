import { useMemo, useState } from 'react'
import { Empty, inputCls } from '../ui'
import { exportCSV, exportExcel, exportPDF } from '../../services/exporters'

// Searchable, sortable table with CSV / Excel / PDF export of exactly the rows shown.
// columns: [{ key, label, render?(row), value?(row) (sort + export), noExport, className }]
export default function DataTable({ rows, columns, title = 'Export', search = true, filters, onRowClick, empty = 'Nothing here yet', pageSize = 50, exportable = true }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(null)
  const [limit, setLimit] = useState(pageSize)
  const val = (row, c) => (c.value ? c.value(row) : row[c.key])

  const shown = useMemo(() => {
    let list = rows
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((r) => columns.some((c) => String(val(r, c) ?? '').toLowerCase().includes(needle)))
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)
      list = [...list].sort((a, b) => {
        const x = val(a, c); const y = val(b, c)
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, columns])

  const exportCols = columns.filter((c) => !c.noExport)
  const toggle = (key) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {search && (
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="sr-only">Search</span>
            <input type="search" placeholder="Search…" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        {filters}
        {exportable && rows.length > 0 && (
          <div className="flex gap-1" aria-label="Export">
            {[['CSV', exportCSV], ['Excel', exportExcel], ['PDF', exportPDF]].map(([name, fn]) => (
              <button key={name} onClick={() => fn(title, shown, exportCols)}
                className="rounded-full border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy/5 focus-visible:outline-2 focus-visible:outline-navy">
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? <Empty title={q ? 'No matches' : empty} /> : (
        <div className="overflow-x-auto rounded-2xl border border-navy/10 bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-navy/10 bg-cream text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2.5 font-semibold" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.noSort ? c.label : (
                      <button onClick={() => toggle(c.key)} className="uppercase tracking-wide hover:text-navy focus-visible:outline-2 focus-visible:outline-navy">
                        {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {shown.slice(0, limit).map((r, i) => (
                <tr key={r.id ?? i} className={onRowClick ? 'cursor-pointer hover:bg-cream' : ''}
                  onClick={onRowClick ? (e) => { if (!e.target.closest('button,a,input,select,label')) onRowClick(r) } : undefined}>
                  {columns.map((c) => <td key={c.key} className={`px-3 py-2.5 align-top ${c.className || ''}`}>{c.render ? c.render(r) : (val(r, c) ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-navy/5 px-3 py-2 text-xs text-slate-500">
            <span>{Math.min(limit, shown.length)} of {shown.length}</span>
            {shown.length > limit && <button className="font-semibold text-navy underline" onClick={() => setLimit((l) => l + pageSize)}>Show more</button>}
          </div>
        </div>
      )}
    </div>
  )
}
