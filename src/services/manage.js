import { supabase } from '../lib/supabase'
import { invalidate } from '../lib/queryCache'

// Thin wrappers over Supabase for the PG-management modules. Every rule (who may do what, money maths,
// status flows) lives in the database: RLS policies and the RPCs in supabase/migrations/2026112100000*.
const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}
const fresh = (r) => { invalidate('catalog'); return r }

export const rpc = (name, args) => supabase.rpc(name, args).then(unwrap)
export const rows = (table, select = '*', build = (q) => q) => build(supabase.from(table).select(select)).then(unwrap)
export const insertRow = (table, row) => supabase.from(table).insert(row).select().single().then(unwrap)
export const updateRow = (table, id, patch, key = 'id') => supabase.from(table).update(patch).eq(key, id).then(unwrap)
export const deleteRow = (table, id, key = 'id') => supabase.from(table).delete().eq(key, id).then(unwrap)

// ---------------------------------------------------------------- files (private buckets, short-lived links)
export async function uploadFile(bucket, folder, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${folder}/${Date.now()}-${safe}`
  unwrap(await supabase.storage.from(bucket).upload(path, file, { contentType: file.type }))
  return path
}
export async function fileUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120)
  if (error) throw error
  return data.signedUrl
}
export const publicUrl = (bucket, path) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl

// Edge Function; its own error message is inside the response body
export async function createUser(fields) {
  const { data, error } = await supabase.functions.invoke('create-user', { body: fields })
  if (error) {
    let detail = error.message
    try { detail = (await error.context.json()).error ?? detail } catch { /* keep generic message */ }
    throw new Error(detail)
  }
  return data
}

// ---------------------------------------------------------------- properties, rooms, beds
export const loadProperties = () => rows('properties', '*', (q) => q.order('id'))
export const loadFloors = (pid) => rows('floors', '*', (q) => q.eq('property_id', pid).order('number'))
export const loadRoomsWithBeds = (pid) =>
  rows('rooms', '*, beds(*)', (q) => (pid ? q.eq('property_id', pid) : q).order('wing').order('floor').order('room_no'))
export const saveRoom = (id, fields) => (id ? updateRow('rooms', id, fields) : insertRow('rooms', fields)).then(fresh)
export const saveBed = (id, fields) => (id ? updateRow('beds', id, fields) : insertRow('beds', fields)).then(fresh)
export const bulkCreateRooms = (a) => rpc('bulk_create_rooms', {
  p_property: a.property, p_floor: a.floor, p_first_room_no: a.first, p_count: a.count, p_beds_per_room: a.beds,
  p_category: a.category, p_room_type: a.roomType, p_ac_type: a.ac, p_price: a.price, p_deposit: a.deposit, p_billing: a.billing, p_wing: a.wing,
}).then(fresh)
export const setFloorActive = (pid, floor, active) => rpc('set_floor_active', { p_property: pid, p_floor: floor, p_active: active }).then(fresh)
export const setBedBlock = (bed, status, reason) => rpc('set_bed_block', { p_bed: bed, p_status: status, p_reason: reason || null }).then(fresh)
export const reserveBed = (a) => rpc('reserve_bed', {
  p_bed: a.bed, p_name: a.name, p_phone: a.phone, p_advance: Number(a.advance || 0), p_expires: a.expires,
  p_customer: a.customer || null, p_enquiry: a.enquiry || null, p_mode: a.mode || null, p_notes: a.notes || '',
}).then(fresh)
export const cancelReservation = (id) => rpc('cancel_reservation', { p_id: id }).then(fresh)
export const loadReservations = () => rows('reservations', '*', (q) => q.eq('status', 'active'))
// who sits in each bed right now (managers only, via RLS)
export const loadOccupants = () =>
  rows('booking_beds', 'bed_id, bookings!inner(id, status, customer_id, rate, check_in, expected_checkout, notice_date, profiles!bookings_customer_id_fkey(full_name, phone))',
    (q) => q.eq('active', true).in('bookings.status', ['active', 'pending']))
export const loadRentHistory = (roomId) => rows('rent_changes', '*', (q) => q.eq('room_id', roomId).order('created_at', { ascending: false }))
export const assignMember = (pid, user, on) => rpc('admin_assign_member', { p_property: pid, p_user: user, p_assigned: on })
export const loadMembers = () => rows('property_members', '*')
export const setRole = (user, role) => rpc('admin_set_role', { p_user: user, p_role: role })
export const loadStaffLogins = () =>
  rows('profiles', 'id, full_name, phone, role, is_active, created_at', (q) => q.neq('role', 'customer').order('full_name'))

// ---------------------------------------------------------------- tenants
export const loadTenants = (pid) => rows('profiles', `id, full_name, phone, is_active, created_at,
    tenant_profiles!tenant_profiles_user_id_fkey(*), bookings!bookings_customer_id_fkey(id, status, property_id, check_in, expected_checkout, actual_checkout, notice_date, rooms(room_no))`,
(q) => q.eq('role', 'customer').order('created_at', { ascending: false }).limit(500))
  .then((list) => (pid ? list.filter((t) => t.tenant_profiles?.property_id === pid || t.bookings.some((b) => b.property_id === pid)) : list))

export async function loadTenant(id) {
  const [profile, bookings, bills, payments, docs, agreements, deposits, credits, recurring, transfers, checklists, complaints] = await Promise.all([
    rows('profiles', '*, tenant_profiles!tenant_profiles_user_id_fkey(*)', (q) => q.eq('id', id).single()),
    rows('bookings', '*, rooms(id, room_no, floor, property_id, rent_basis), booking_beds(active, bed_id, beds(code, label))',
      (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
    rows('bills', '*, bill_lines(*)', (q) => q.eq('customer_id', id).order('due_date', { ascending: false })),
    rows('payments', '*, bills(description, invoice_no)', (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
    rows('customer_documents', '*', (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
    rows('agreements', '*', (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
    rows('security_deposits', '*', (q) => q.eq('customer_id', id)),
    rows('tenant_credits', '*', (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
    rows('recurring_charges', '*, bookings!inner(customer_id)', (q) => q.eq('bookings.customer_id', id)),
    rows('stay_transfers', '*, bookings!inner(customer_id)', (q) => q.eq('bookings.customer_id', id).order('created_at', { ascending: false })),
    rows('stay_checklists', '*, bookings!inner(customer_id)', (q) => q.eq('bookings.customer_id', id)),
    rows('complaints', '*', (q) => q.eq('customer_id', id).order('created_at', { ascending: false })),
  ])
  return { profile, bookings, bills, payments, docs, agreements, deposits, credits, recurring, transfers, checklists, complaints }
}
export const saveTenant = (id, fields) => rpc('staff_save_tenant', { p_user: id, p: fields })
export const saveMyTenantProfile = (fields) => rpc('save_my_tenant_profile', { p: fields })
export const setApproval = (id, status, note) => rpc('set_tenant_approval', { p_user: id, p_status: status, p_note: note || '' })
export const setPolice = (id, status, ref, date) => rpc('set_police_verification', { p_user: id, p_status: status, p_ref: ref || '', p_date: date || null })
export const reviewDocument = (id, status, note) => rpc('review_document', { p_doc: id, p_status: status, p_note: note || '' })
export async function uploadTenantDocument(customerId, file, meta) {
  const path = await uploadFile('customer-documents', customerId, file)
  const res = await supabase.from('customer_documents').insert({
    customer_id: customerId, booking_id: meta.bookingId || null, doc_type: meta.docType, id_type: meta.idType || null,
    side: meta.side || 'single', id_last4: meta.last4 || null, file_path: path, file_name: file.name,
  }).select().single()
  if (res.error) { await supabase.storage.from('customer-documents').remove([path]); throw res.error }
  return res.data
}
export const checkIn = (fields) => rpc('check_in_tenant', { p: fields }).then(fresh)
export const giveNotice = (booking, date, noticeDate) => rpc('give_notice', { p_booking: booking, p_planned_checkout: date, p_notice_date: noticeDate || undefined })
export const transferStay = (booking, beds, date, rate, reason) =>
  rpc('transfer_stay', { p_booking: booking, p_to_beds: beds, p_date: date, p_new_rate: rate ? Number(rate) : null, p_reason: reason || '' }).then(fresh)
export const checkoutQuote = (booking, date, extras) => rpc('checkout_quote', { p_booking: booking, p_date: date, p_extras: extras })
export const checkOut = (booking, date, extras, mode, ref, notes) => rpc('check_out_tenant', {
  p_booking: booking, p_date: date, p_extras: extras, p_refund_mode: mode || null, p_refund_reference: ref || null, p_notes: notes || '',
}).then(fresh)
export const saveChecklist = (row) => supabase.from('stay_checklists').upsert(row, { onConflict: 'booking_id,kind' }).then(unwrap)
export const generateAgreement = (booking, end, rules) => rpc('generate_agreement', { p_booking: booking, p_end: end, p_rules: rules || null })
export const recordAgreement = (a) => rpc('record_agreement', {
  p_booking: a.booking, p_start: a.start, p_end: a.end, p_lock_in: Number(a.lockIn || 0), p_notice: Number(a.notice || 30),
  p_rent: Number(a.rent), p_deposit: Number(a.deposit || 0), p_rules: a.rules || '', p_document: a.document || null,
})
export const setAgreementStatus = (id, status) => rpc('set_agreement_status', { p_id: id, p_status: status })
export const acceptAgreement = (id, name, rules) => rpc('accept_agreement', { p_id: id, p_name: name, p_rules_accepted: rules })

// ---------------------------------------------------------------- invoices and payments
export const loadInvoices = ({ from, to, status } = {}) =>
  rows('bills', '*, bill_lines(*), profiles(full_name, phone), bookings(property_id, rooms(room_no))', (q) => {
    let x = q.neq('status', 'void').order('due_date', { ascending: false }).limit(500)
    if (from) x = x.gte('due_date', from)
    if (to) x = x.lte('due_date', to)
    if (status === 'unpaid') x = x.eq('status', 'unpaid')
    if (status === 'paid') x = x.eq('status', 'paid')
    return x
  })
export const generateInvoices = () => rpc('generate_monthly_invoices')
export const addBillLine = (bill, kind, description, amount, reason) =>
  rpc('add_bill_line', { p_bill: bill, p_kind: kind, p_description: description, p_amount: Number(amount), p_reason: reason || '' })
export const removeBillLine = (id, reason) => rpc('remove_bill_line', { p_line: id, p_reason: reason })
export const voidBill = (id, reason) => rpc('void_bill', { p_bill: id, p_reason: reason })
export const recordPayment = (a) => rpc('record_manual_payment', {
  p_bill: a.bill, p_amount: Number(a.amount), p_mode: a.mode, p_reference: a.reference || null,
  p_paid_on: a.paidOn, p_proof_path: a.proof || null, p_notes: a.notes || '',
})
export const recordAdvance = (customer, amount, mode, ref) =>
  rpc('record_advance', { p_customer: customer, p_amount: Number(amount), p_mode: mode, p_reference: ref || null })
export const addCharge = (booking, kind, description, amount, recurring) =>
  rpc('staff_add_charge', { p_booking: booking, p_kind: kind, p_description: description, p_amount: Number(amount), p_recurring: Boolean(recurring) })
export const addElectricity = (a) => rpc('add_electricity', {
  p_room: a.room, p_month: a.month, p_mode: a.mode, p_amount: a.amount ? Number(a.amount) : null,
  p_prev: a.prev === '' ? null : Number(a.prev), p_curr: a.curr === '' ? null : Number(a.curr), p_rate: a.rate === '' ? null : Number(a.rate),
})
export const sendReminder = (bill) => rpc('send_bill_reminder', { p_bill: bill, p_manual: true })
export const recordDeposit = (booking, amount, mode, ref, date) =>
  rpc('record_deposit_received', { p_booking: booking, p_amount: Number(amount), p_mode: mode, p_reference: ref || null, p_date: date })
export const loadMeterReadings = () => rows('meter_readings', '*, rooms(room_no, property_id)', (q) => q.order('month', { ascending: false }).limit(100))

// ---------------------------------------------------------------- complaints and expenses
export const raiseComplaint = (fields) => rpc('raise_complaint', { p: fields })
export const updateComplaint = (id, fields) => rpc('update_complaint', { p_id: id, p: fields })
export const loadComplaints = () =>
  rows('complaints', '*, rooms(room_no), beds(code), profiles!complaints_customer_id_fkey(full_name, phone), vendors(name)',
    (q) => q.order('created_at', { ascending: false }).limit(500))
export const loadComplaintEvents = (id) => rows('complaint_events', '*, profiles(full_name)', (q) => q.eq('complaint_id', id).order('id'))
export const staffDirectory = (pid) => rpc('staff_directory', { p_property: pid })
export const approveExpense = (id, ok) => rpc('approve_expense', { p_id: id, p_approve: ok })

// ---------------------------------------------------------------- enquiries and sales
export const submitEnquiry = (fields) => rpc('submit_enquiry', { p: fields })
export const loadEnquiries = () =>
  rows('enquiries', '*, campaigns(name), brokers(name)', (q) => q.order('received_at', { ascending: false }).limit(1000))
export async function loadEnquiry(id) {
  const [e, acts, fus, visits, subs] = await Promise.all([
    rows('enquiries', '*, campaigns(name), brokers(name)', (q) => q.eq('id', id).single()),
    rows('enquiry_activities', '*, profiles(full_name)', (q) => q.eq('enquiry_id', id).order('created_at', { ascending: false })),
    rows('follow_ups', '*', (q) => q.eq('enquiry_id', id).order('due_at')),
    rows('site_visits', '*', (q) => q.eq('enquiry_id', id).order('scheduled_at', { ascending: false })),
    rows('enquiry_submissions', '*', (q) => q.eq('enquiry_id', id).order('received_at', { ascending: false })),
  ])
  return { e, acts, fus, visits, subs }
}
export const updateEnquiry = (id, patch) => updateRow('enquiries', id, patch)
export const logLeadActivity = (id, kind, outcome, notes, next, followUp) => rpc('log_lead_activity', {
  p_enquiry: id, p_kind: kind, p_outcome: outcome || '', p_notes: notes || '', p_next_step: next || '', p_follow_up: followUp || null,
})
export const scheduleFollowUp = (id, due, note) => rpc('schedule_follow_up', { p_enquiry: id, p_due: due, p_note: note || '' })
export const completeFollowUp = (id, outcome) => rpc('complete_follow_up', { p_id: id, p_outcome: outcome || '' })
export const scheduleVisit = (id, when, pid, notes) => rpc('schedule_visit', { p_enquiry: id, p_when: when, p_property: pid || null, p_notes: notes || '' })
export const setVisitStatus = (id, status, notes) => rpc('set_visit_status', { p_visit: id, p_status: status, p_notes: notes || '' })
export const importEnquiries = (list) => rpc('import_enquiries', { p_rows: list })
export const sendBulkMessage = (ids, channels, subject, body) =>
  rpc('send_bulk_message', { p_enquiries: ids, p_channels: channels, p_subject: subject || '', p_body: body })
export const loadMyFollowUps = () =>
  rows('follow_ups', '*, enquiries(id, name, phone, status, temperature)', (q) => q.is('done_at', null).order('due_at').limit(300))
export const loadVisits = () =>
  rows('site_visits', '*, enquiries(id, name, phone)', (q) => q.order('scheduled_at', { ascending: false }).limit(300))
export const addCampaignSpend = (id, amount, date, vendor, notes) =>
  rpc('add_campaign_spend', { p_campaign: id, p_amount: Number(amount), p_date: date, p_vendor: vendor || '', p_notes: notes || '' })
export const payCommission = (id, mode, ref, date) => rpc('pay_broker_commission', { p_id: id, p_mode: mode, p_reference: ref || '', p_date: date })
export const markReferralPaid = (id) => rpc('mark_referral_paid', { p_id: id })
export const checkOffer = (code, pid, checkIn, lockIn) => rpc('check_offer', { p_code: code, p_property: pid, p_check_in: checkIn, p_lock_in: Number(lockIn || 0) })

// ---------------------------------------------------------------- employees
export const markAttendance = (staff, date, status, ot, notes, leaveType) =>
  rpc('mark_attendance', { p_staff: staff, p_date: date, p_status: status, p_overtime: Number(ot || 0), p_notes: notes || '', p_leave_type: leaveType || null })
export const staffCheckIn = (lat, lng, selfie) => rpc('staff_check_in', { p_lat: lat, p_lng: lng, p_selfie: selfie })
export const staffCheckOut = () => rpc('staff_check_out')
export const leaveBalance = (staff) => rpc('leave_balance', { p_staff: staff })
export const requestLeave = (staff, type, from, to, reason, half) =>
  rpc('request_leave', { p_staff: staff || null, p_type: type, p_from: from, p_to: to, p_reason: reason || '', p_half: Boolean(half) })
export const decideLeave = (id, ok) => rpc('decide_leave', { p_id: id, p_approve: ok })
export const generatePayroll = (month, pid) => rpc('generate_payroll', { p_month: month, p_property: pid })
export const updatePayslip = (id, bonus, deductions, notes) =>
  rpc('update_payslip', { p_id: id, p_bonus: Number(bonus || 0), p_other_deductions: Number(deductions || 0), p_notes: notes || '' })
export const payPayslip = (id, mode, ref, date) => rpc('pay_payslip', { p_id: id, p_mode: mode, p_reference: ref || '', p_date: date })
export const completeTask = (id, photo, notes) => rpc('complete_task', { p_id: id, p_photo: photo || null, p_notes: notes || '' })

// ---------------------------------------------------------------- dashboards, reports, settings, inbox
export const ownerDashboard = (pid) => rpc('owner_dashboard', { p_property: pid || null })
export const runJobs = (force = false) => rpc('run_scheduled_jobs', { p_force: force })
export const setSetting = (key, value) => rpc('admin_set_setting', { p_key: key, p_value: value })
export const loadSettings = () => rows('app_settings', '*')
export const loadMyNotifications = (userId) =>
  rows('notifications', '*', (q) => q.eq('user_id', userId).eq('channel', 'in_app').order('created_at', { ascending: false }).limit(50))
export const markNotificationsRead = (ids) => rpc('mark_notifications_read', { p_ids: ids ?? null })
