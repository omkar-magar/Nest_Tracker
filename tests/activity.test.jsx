import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { asRole } from './helpers/authMock'
import { db, resetMock, supabase } from './helpers/supabaseMock'
import { ScopeProvider } from '../src/components/manage/kit'
import Registrations from '../src/pages/manage/Registrations'
import Activity from '../src/pages/manage/Activity'
import { describe as describeItem, handling, registrationLink, timing } from '../src/services/activity'

const props = [{ id: 'P1', name: 'A wing' }, { id: 'P2', name: 'B wing' }]
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }
const at = (page, url = '/admin/x') => render(
  <MemoryRouter initialEntries={[url]}>
    <ScopeProvider properties={props}>
      <Routes><Route path="*" element={<>{page}<Where /></>} /></Routes>
    </ScopeProvider>
  </MemoryRouter>)

const now = new Date()
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString()
const waiting = { id: 'u1', name: 'Amit', phone: '9800000000', stage: 'waiting', property_id: 'P1', signed_up_at: hoursAgo(20),
  submitted_at: hoursAgo(14), handlers: [{ name: 'Priya', seen: true }, { name: 'Rahul', seen: false }] }
const living = { id: 'u2', name: 'Neha', phone: '9800000001', stage: 'living', property_id: 'P2', signed_up_at: hoursAgo(50),
  submitted_at: hoursAgo(48), approved_at: hoursAgo(47), approved_by: 'Rahul', room_no: 'B-204', handlers: [] }
const started = { id: 'u3', name: 'Ravi', phone: '9800000002', stage: 'started', property_id: null, signed_up_at: hoursAgo(2), submitted_at: null, handlers: [] }

beforeEach(() => { resetMock(); sessionStorage.clear(); asRole('admin') })

describe('registration helpers', () => {
  it('flags long waits and works out who is handling it', () => {
    expect(timing(waiting, now)).toEqual({ text: 'waiting 14h 0m', late: true })
    expect(timing({ ...waiting, submitted_at: hoursAgo(2) }, now).late).toBe(false)
    expect(timing(living, now)).toEqual({ text: 'took 1h 0m', late: false })
    expect(handling(waiting)).toBe('Priya, Rahul · seen by Priya')
    expect(handling({ ...waiting, handlers: [] })).toBe('No manager alerted for this wing')
    expect(handling(living)).toBe('Approved by Rahul')
    expect(handling(started)).toBe('Not sent yet')
    expect(registrationLink(waiting).to).toBe('/admin/register?wing=P1&tab=new')
    expect(registrationLink(living).to).toBe('/admin/register?wing=P2&q=Neha')
    expect(registrationLink(started).to).toBe('/admin/tenants/u3')
  })
  it('turns feed items into sentences with links to the work', () => {
    expect(describeItem('complaints', { kind: 'raised', ref: 'c1', name: 'Tap leaking', detail: '#4 · high', who: 'Amit' }))
      .toEqual({ text: 'New complaint: Tap leaking', sub: '#4 · high · Amit', to: '/admin/complaints?open=c1' })
    expect(describeItem('money', { kind: 'rent_paid', ref: '9', name: 'Neha', detail: 'Room B-204', who: 'Rahul', property_id: 'P2', amount: 6000 }))
      .toEqual({ text: 'Neha rent marked paid ₹6,000', sub: 'Room B-204 · by Rahul', to: '/admin/register?wing=P2&q=Neha' })
    expect(describeItem('submissions', { kind: 'leave', ref: 'l1', name: 'Sunil', detail: 'sick · 2 days' }).to).toBe('/admin/staff?tab=leave')
    expect(describeItem('registrations', { kind: 'submitted', ref: 'u1', name: 'Amit', open: true }))
      .toEqual({ text: 'Amit registered', sub: 'Waiting for approval', to: '/admin/registrations?open=u1' })
  })
})

describe('Registrations page', () => {
  beforeEach(() => {
    db.rpcs.admin_registrations = { data: { counts: { waiting: 1, started: 1, rejected: 0, living: 1, ended: 0 }, rows: [waiting, living, started] } }
  })
  it('lists every registration with stage, wing and handler, and filters by stage', async () => {
    at(<Registrations />)
    expect(await screen.findByText('Amit')).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('admin_registrations', { p_property: null })
    expect(screen.getByText(/has been waiting over 12 hours/)).toBeInTheDocument()
    expect(screen.getByText('Priya, Rahul · seen by Priya')).toBeInTheDocument()
    expect(screen.getByText('No wing picked')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Approved · living/ }))
    expect(screen.queryByText('Amit')).not.toBeInTheDocument()
    expect(screen.getByText('Neha')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in register' })).toHaveAttribute('href', '/admin/register?wing=P2&q=Neha')
  })
  it('opens the steps of the registration named in the link', async () => {
    at(<Registrations />, '/admin/registrations?open=u2')
    const steps = await screen.findByRole('list', { name: 'Steps for Neha' })
    expect(within(steps).getByText('Approved by Rahul · Room B-204', { exact: false })).toBeInTheDocument()
    expect(within(steps).getByText(/Sent the form · B wing/)).toBeInTheDocument()
  })
})

describe('Recent activity page', () => {
  it('shows each area with what needs action and links rows to the work', async () => {
    db.rpcs.admin_recent_activity = { data: {
      registrations: { count: 1, open: 1, items: [{ kind: 'submitted', ref: 'u1', name: 'Amit', property_id: 'P1', at: hoursAgo(1), open: true }] },
      complaints: { count: 3, open: 1, items: [{ kind: 'raised', ref: 'c1', name: 'Tap leaking', detail: '#4', who: 'Amit', property_id: 'P1', at: hoursAgo(2), open: true }] },
    } }
    at(<Activity />)
    const regs = await screen.findByRole('region', { name: /Registrations/ })
    expect(supabase.rpc).toHaveBeenCalledWith('admin_recent_activity', { p_property: null, p_days: 7 })
    expect(within(regs).getByText('1 to act on')).toBeInTheDocument()
    expect(screen.getByText('2 items still need action.')).toBeInTheDocument()
    expect(screen.getByText('Showing the latest 1 of 3.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /Money/ })).getByText('Nothing in this period.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /Amit registered/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/registrations?open=u1')
  })
  it('changes the period', async () => {
    db.rpcs.admin_recent_activity = { data: {} }
    at(<Activity />)
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }))
    expect(supabase.rpc).toHaveBeenCalledWith('admin_recent_activity', { p_property: null, p_days: 1 })
  })
})
