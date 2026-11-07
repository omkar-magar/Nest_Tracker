import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

export const Where = () => {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

export function renderAt(ui, route = '/') {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)
}

// Renders ui at `path` and shows the current URL, to assert redirects.
export function renderRoute(ui, { path = '/', route = path } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={ui} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}
