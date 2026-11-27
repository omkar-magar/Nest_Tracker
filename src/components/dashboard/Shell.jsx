import AppFrame, { NavGroup, NavItem, TabItem } from './AppFrame'

// Tabbed page for the staff, caretaker and manager apps: the tabs sit in the left sidebar (a drawer on phones).
// tabs: [key, label, group?, icon?]; links: [to, label, icon] added below the tabs (e.g. the full console).
// embedded: shown inside the management console, which already has the sidebar, so the tabs become a top row.
export default function Shell({ title, tabs, tab, onTab, children, embedded = false, actions, links = [] }) {
  if (embedded) {
    return (
      <div className="text-navy">
        <div role="tablist" aria-label={title} className="flex gap-1 overflow-x-auto border-b border-navy/10">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => onTab(key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-navy ${tab === key ? 'border-gold text-navy' : 'border-transparent text-slate-600 hover:text-navy'}`}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="py-6">{children}</div>
      </div>
    )
  }
  const groups = [...new Set(tabs.map((t) => t[2] ?? ''))]
  const current = tabs.find(([key]) => key === tab)?.[1]
  const nav = (close) => (
    <>
      {groups.map((g) => (
        <NavGroup key={g || 'main'} title={g || title} tablist>
          {tabs.filter((t) => (t[2] ?? '') === g).map(([key, label, , icon]) => (
            <TabItem key={key} selected={tab === key} icon={icon} onClick={() => { onTab(key); close() }}>{label}</TabItem>
          ))}
        </NavGroup>
      ))}
      {links.length > 0 && (
        <nav aria-label="More">
          <NavGroup title="More">
            {links.map(([to, label, icon]) => <NavItem key={to} to={to} icon={icon} onClick={close}>{label}</NavItem>)}
          </NavGroup>
        </nav>
      )}
    </>
  )
  return (
    <AppFrame title={title} nav={nav} actions={actions}>
      <div role="tabpanel" aria-label={current}>
        {current && <h2 className="mb-4 text-xl font-bold">{current}</h2>}
        {children}
      </div>
    </AppFrame>
  )
}
