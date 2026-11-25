// @vitest-environment node
// Complaint management rules against real Postgres (PGlite): residents see only their own complaints,
// both managers see everything but only take unassigned ones and work on their own, the owner assigns,
// reassigns, re-prioritises, closes and reopens, and every action lands in the append-only history.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, freshDb, makeUser } from './pg'

let db, owner, mgrA, mgrB, booked, registered, homeless, cid
const emergency = { emergency1_name: 'Asha', emergency1_relation: 'Mother', emergency1_phone: '9811111111', rules_accepted: true }
const one = async (sql, p) => (await db.query(sql, p)).rows[0]
const upd = (user, patch) => as(db, user, ({ q }) => q('select public.update_complaint($1, $2)', [cid, patch]))
const state = () => one('select status, assigned_to, priority, reopen_count, resolution from public.complaints where id = $1', [cid])
const notes = (user, like = '%') => one("select count(*)::int n from public.notifications where user_id = $1 and kind = 'complaint' and channel = 'in_app' and subject like $2", [user, like])

beforeAll(async () => {
  db = await freshDb()
  owner = await makeUser(db, 'admin', 'Owner')
  mgrA = await makeUser(db, 'manager', 'Anil')
  mgrB = await makeUser(db, 'manager', 'Bina')
  booked = await makeUser(db, 'customer', 'Ravi')
  registered = await makeUser(db, 'customer', 'Sita')
  homeless = await makeUser(db, 'customer', 'Nobody')
  await as(db, owner, async ({ q }) => {
    await q("select public.admin_assign_member('P1', $1, true)", [mgrA])
    await q("select public.admin_assign_member('P2', $1, true)", [mgrB])
  })
  // Ravi has a booking in A wing; Sita only has a guest-register stay in B wing
  await as(db, booked, ({ q }) => q('select public.save_my_tenant_profile($1)', [emergency]))
  const bed = await one("select id from public.beds where room_id = 'pg-101' order by label limit 1")
  await as(db, mgrA, ({ q }) => q('select public.check_in_tenant($1)', [{ customer_id: booked, bed_ids: [bed.id], deposit: 0 }]))
  await db.query("insert into public.register_guests (property_id, room_no, name, customer_id) values ('P2', 'B-201', 'Sita', $1)", [registered])
}, 120000)

describe('raising', () => {
  it('lets a resident with only a register stay raise one, linked to their room, and alerts owner and both managers', async () => {
    const r = await as(db, registered, ({ one: o }) => o('select public.raise_complaint($1) id',
      [{ category: 'maintenance', title: 'Cupboard door broken', description: 'Hinge came off', photos: [`${registered}/a.jpg`] }]))
    cid = r.id
    const c = await one('select property_id, room_label, register_guest_id is not null linked, status, priority, assigned_to from public.complaints where id = $1', [cid])
    expect(c).toEqual({ property_id: 'P2', room_label: 'B-201', linked: true, status: 'new', priority: 'medium', assigned_to: null })
    for (const u of [owner, mgrA, mgrB]) expect((await notes(u, 'New complaint%')).n).toBe(1)
    expect((await one('select action from public.complaint_events where complaint_id = $1', [cid])).action).toBe('created')
  })

  it('rejects residents without a stay, other people\'s files, too many images and unknown categories', async () => {
    const raise = (u, p) => as(db, u, ({ q }) => q('select public.raise_complaint($1)', [p]))
    await expect(raise(homeless, { category: 'plumbing', title: 'Tap leaking' })).rejects.toThrow(/active stay/)
    await expect(raise(booked, { category: 'plumbing', title: 'Tap leaking', photos: [`${registered}/a.jpg`] })).rejects.toThrow(/uploaded by you/)
    await expect(raise(booked, { category: 'plumbing', title: 'Tap leaking', photos: [1, 2, 3, 4, 5, 6].map((i) => `${booked}/${i}.jpg`) })).rejects.toThrow(/at most 5/)
    await expect(raise(booked, { category: 'gardening', title: 'Tap leaking' })).rejects.toThrow(/category/)
    await expect(raise(booked, { category: 'plumbing', title: 'x' })).rejects.toThrow(/3 to 120/)
  })

  it('keeps residents out of each other\'s complaints', async () => {
    await as(db, booked, ({ q }) => q('select public.raise_complaint($1)', [{ category: 'wifi', title: 'Wi-Fi drops at night' }]))
    const seen = await as(db, booked, ({ q }) => q('select title from public.complaints'))
    expect(seen.map((x) => x.title)).toEqual(['Wi-Fi drops at night'])
    expect((await as(db, booked, ({ q }) => q('select * from public.my_complaints()'))).length).toBe(1)
    await expect(as(db, booked, ({ q }) => q('select * from public.complaint_timeline($1)', [cid]))).rejects.toThrow(/not found/)
    await expect(upd(booked, { status: 'reopen', note: 'x' })).rejects.toThrow(/not found/)
    const ev = await as(db, booked, ({ q }) => q('select * from public.complaint_events where complaint_id = $1', [cid]))
    expect(ev).toEqual([])
  })
})

describe('managers', () => {
  it('see complaints from both wings', async () => {
    const a = await as(db, mgrA, ({ q }) => q('select property_id from public.complaints order by property_id'))
    expect(a.map((x) => x.property_id)).toEqual(['P1', 'P2'])
  })

  it('cannot assign to the other manager, but can take an unassigned complaint for themselves', async () => {
    await expect(upd(mgrA, { assigned_to: mgrB })).rejects.toThrow(/Only the admin can assign/)
    await expect(upd(mgrA, { status: 'in_progress' })).rejects.toThrow(/assigned to you/)
    await upd(mgrA, { assigned_to: mgrA, note: 'I will check it' })
    expect(await state()).toMatchObject({ status: 'assigned', assigned_to: mgrA })
    const e = await one("select action, to_assignee, note from public.complaint_events where complaint_id = $1 order by id desc limit 1", [cid])
    expect(e).toEqual({ action: 'taken', to_assignee: mgrA, note: 'I will check it' })
  })

  it('cannot take, work on, re-prioritise or close a complaint that is not theirs', async () => {
    await expect(upd(mgrB, { assigned_to: mgrB })).rejects.toThrow(/already assigned/)
    await expect(upd(mgrB, { status: 'in_progress' })).rejects.toThrow(/assigned to you/)
    await expect(upd(mgrB, { resolution: 'done' })).rejects.toThrow(/assigned to you/)
    await expect(upd(mgrB, { note: 'hello' })).rejects.toThrow(/assigned to you/)
    await expect(upd(mgrA, { priority: 'urgent' })).rejects.toThrow(/Only the admin can change priority/)
    await expect(upd(mgrA, { status: 'closed' })).rejects.toThrow(/Only the admin can close/)
  })

  it('work their own complaint through to resolved, with notes and images, and the resident hears each step', async () => {
    await upd(mgrA, { status: 'in_progress', note: 'Carpenter called' })
    await expect(upd(mgrA, { status: 'resolved' })).rejects.toThrow(/resolution notes/)
    await expect(upd(mgrA, { after_photos: [`${mgrB}/x.jpg`] })).rejects.toThrow(/uploaded by you/)
    await upd(mgrA, { resolution: 'New hinge fitted', after_photos: [`${mgrA}/after.jpg`], status: 'resolved' })
    const c = await one('select status, after_photos, resolved_at is not null done from public.complaints where id = $1', [cid])
    expect(c).toEqual({ status: 'resolved', after_photos: [`${mgrA}/after.jpg`], done: true })
    expect((await notes(registered)).n).toBe(3)   // assigned, in progress, resolved
    const mine = await as(db, registered, ({ q }) => q('select assignee_name, status from public.my_complaints()'))
    expect(mine).toEqual([{ assignee_name: 'Anil', status: 'resolved' }])
  })
})

describe('resident reopen and owner control', () => {
  it('lets the resident reopen a resolved complaint with a reason', async () => {
    await expect(upd(registered, { status: 'reopen' })).rejects.toThrow(/still wrong/)
    await expect(upd(registered, { status: 'closed', rating: 9 })).rejects.toThrow(/1 to 5/)
    await upd(registered, { status: 'reopen', note: 'Door still loose' })
    expect(await state()).toMatchObject({ status: 'assigned', reopen_count: 1, assigned_to: mgrA })
  })

  it('lets the owner reassign, re-prioritise, close and reopen, and notifies the new manager', async () => {
    await upd(owner, { assigned_to: mgrB, note: 'Bina is on site today' })
    expect(await state()).toMatchObject({ status: 'assigned', assigned_to: mgrB })
    expect((await notes(mgrB, '%assigned to you')).n).toBe(1)
    await expect(upd(mgrA, { status: 'in_progress' })).rejects.toThrow(/assigned to you/)
    await upd(owner, { priority: 'high' })
    await upd(owner, { status: 'closed', note: 'Confirmed on call' })
    await expect(upd(registered, { status: 'reopen', note: 'again' })).rejects.toThrow(/Cannot move/)
    await upd(owner, { status: 'reopen', note: 'Resident called again' })
    expect(await state()).toMatchObject({ status: 'assigned', priority: 'high', reopen_count: 2 })
    await upd(owner, { assigned_to: null })
    expect(await state()).toMatchObject({ status: 'new', assigned_to: null })
  })

  it('records the whole history with names, assignment changes and priority changes', async () => {
    const t = await as(db, owner, ({ q }) => q('select * from public.complaint_timeline($1)', [cid]))
    expect(t.map((e) => e.action)).toEqual(['created', 'taken', 'started', 'work_updated', 'resolved', 'reopened', 'reassigned',
      'priority_changed', 'closed', 'reopened', 'unassigned'])
    const re = t.find((e) => e.action === 'reassigned')
    expect(re).toMatchObject({ actor_name: 'Owner', from_assignee_name: 'Anil', to_assignee_name: 'Bina', note: 'Bina is on site today' })
    expect(t.find((e) => e.action === 'priority_changed').details).toEqual({ from: 'medium', to: 'high' })
    expect((await as(db, registered, ({ q }) => q('select * from public.complaint_timeline($1)', [cid]))).length).toBe(t.length)
  })

  it('does not let anyone edit the history', async () => {
    await expect(as(db, owner, ({ q }) => q("update public.complaint_events set note = 'x' where complaint_id = $1", [cid]))).rejects.toThrow()
    await expect(db.query("update public.complaint_events set note = 'x' where complaint_id = $1", [cid])).rejects.toThrow(/cannot be changed/)
  })

  it('summarises counts, average resolution time and each manager\'s load', async () => {
    const s = (await as(db, owner, ({ one: o }) => o('select public.complaint_stats() s'))).s
    expect(s).toMatchObject({ total: 2, open: 2, unassigned: 2, in_progress: 0 })
    expect(s.by_assignee.map((x) => x.name)).toEqual(['Anil', 'Bina'])
    expect((await as(db, mgrB, ({ one: o }) => o('select public.complaint_stats() s'))).s.total).toBe(2)
    await expect(as(db, booked, ({ q }) => q('select public.complaint_stats()'))).rejects.toThrow(/Not allowed/)
    const names = await as(db, owner, ({ q }) => q('select full_name, role from public.complaint_assignees()'))
    expect(names.slice(0, 2)).toEqual([{ full_name: 'Anil', role: 'manager' }, { full_name: 'Bina', role: 'manager' }])
  })
})
