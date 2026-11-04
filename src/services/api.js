import { supabase } from '../lib/supabase'

// Thin wrappers over Supabase. Each throws on error so callers can show it; nothing is swallowed here.
const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

// ---------------------------------------------------------------- customer
export const bookRoom = ({ roomId, bedCount, checkIn, checkOut }) =>
  supabase
    .rpc('book_room', { p_room_id: roomId, p_bed_count: bedCount, p_check_in: checkIn, p_check_out: checkOut || null })
    .then(unwrap)

export const cancelBooking = (id) => supabase.rpc('cancel_booking', { p_booking_id: id }).then(unwrap)

export async function loadMyAccount(userId) {
  const [bookings, bills, payments, documents, review] = await Promise.all([
    supabase.from('bookings').select('*, rooms(room_no, floor, ac_type, category_id), booking_beds(active, beds(label))')
      .eq('customer_id', userId).order('created_at', { ascending: false }),
    supabase.from('bills').select('*').eq('customer_id', userId).order('due_date'),
    supabase.from('payments').select('*, bills(description)').eq('customer_id', userId).order('created_at', { ascending: false }),
    supabase.from('customer_documents').select('*').eq('customer_id', userId).order('created_at', { ascending: false }),
    supabase.from('reviews').select('*').eq('customer_id', userId).maybeSingle(),
  ])
  return {
    bookings: unwrap(bookings),
    bills: unwrap(bills),
    payments: unwrap(payments),
    documents: unwrap(documents),
    review: unwrap(review),
  }
}

export const updateMyProfile = (userId, { full_name, phone }) =>
  supabase.from('profiles').update({ full_name, phone: phone.replace(/\D/g, '') || null }).eq('id', userId).then(unwrap)

export async function uploadDocument(userId, file, docType, bookingId) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${userId}/${Date.now()}-${safe}`
  unwrap(await supabase.storage.from('customer-documents').upload(path, file, { contentType: file.type }))
  const res = await supabase.from('customer_documents')
    .insert({ customer_id: userId, booking_id: bookingId || null, doc_type: docType, file_path: path, file_name: file.name })
  if (res.error) {
    await supabase.storage.from('customer-documents').remove([path]) // no orphan file
    throw res.error
  }
}

export async function deleteDocument(doc) {
  unwrap(await supabase.from('customer_documents').delete().eq('id', doc.id))
  await supabase.storage.from('customer-documents').remove([doc.file_path])
}

// Short-lived link. The bucket is private, so this is the only way to open a file.
export async function documentUrl(path) {
  const { data, error } = await supabase.storage.from('customer-documents').createSignedUrl(path, 60)
  if (error) throw error
  return data.signedUrl
}

export const submitReview = (userId, authorName, rating, body) =>
  supabase.from('reviews').insert({ customer_id: userId, author_name: authorName, rating, body }).then(unwrap)

// ---------------------------------------------------------------- staff
export const staffOverview = () => supabase.rpc('staff_customer_overview').then(unwrap)

export const loadMyPermissions = (userId) =>
  supabase.from('employee_permissions').select('*').eq('employee_id', userId).maybeSingle().then(unwrap)

export const loadBeds = () =>
  supabase.from('rooms').select('id, room_no, floor, ac_type, rent_basis, category_id, beds(id, label, status, is_occupied)')
    .eq('is_active', true).order('room_no').then(unwrap)

export const setBedStatus = (bedId, status) => supabase.rpc('set_bed_status', { p_bed_id: bedId, p_status: status }).then(unwrap)

// ---------------------------------------------------------------- admin
export const adminStats = () => supabase.rpc('admin_dashboard_stats').then(unwrap)

export const adminCustomers = () =>
  supabase.from('profiles').select(`
    id, full_name, phone, is_active, created_at,
    bookings(id, status, check_in, check_out, rooms(room_no), booking_beds(active, beds(label))),
    bills(id, amount, status, due_date, description),
    customer_documents(id, doc_type, file_name, file_path)
  `).eq('role', 'customer').order('created_at', { ascending: false }).then(unwrap)

export const adminBills = () =>
  supabase.from('bills').select('*, profiles(full_name, phone), bookings(rooms(room_no))').order('due_date').then(unwrap)

export const adminPayments = () =>
  supabase.from('payments').select('*, profiles(full_name), bills(description)').order('created_at', { ascending: false }).limit(200).then(unwrap)

export const adminEmployees = () =>
  supabase.from('profiles').select('id, full_name, phone, is_active, created_at, employee_permissions(*)')
    .eq('role', 'employee').order('created_at').then(unwrap)

export const adminActivity = () =>
  supabase.from('activity_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(100).then(unwrap)

export const adminReviews = () => supabase.from('reviews').select('*').order('created_at', { ascending: false }).then(unwrap)
export const setReviewStatus = (id, status) => supabase.from('reviews').update({ status }).eq('id', id).then(unwrap)

export const recordCashPayment = (billId) => supabase.rpc('admin_record_cash_payment', { p_bill_id: billId }).then(unwrap)
export const endBooking = (id) => supabase.rpc('admin_end_booking', { p_booking_id: id }).then(unwrap)
export const setUserActive = (id, active) => supabase.rpc('admin_set_user_active', { p_user: id, p_active: active }).then(unwrap)
export const setEmployeePermissions = (id, perms) =>
  supabase.rpc('admin_set_employee_permissions', { p_employee: id, p_perms: perms }).then(unwrap)

export async function createEmployee(fields) {
  const { data, error } = await supabase.functions.invoke('create-employee', { body: fields })
  if (error) {
    // the function's own message is in the response body
    let detail = error.message
    try { detail = (await error.context.json()).error ?? detail } catch { /* keep generic message */ }
    throw new Error(detail)
  }
  return data
}

export const updateRoom = (id, fields) => supabase.from('rooms').update(fields).eq('id', id).then(unwrap)
