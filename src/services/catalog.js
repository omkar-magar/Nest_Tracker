import { supabase, isConfigured } from '../lib/supabase'
import { amenities as staticAmenities, categories as staticCategories, rooms as staticRooms } from '../data/site'

// One room shape for the whole UI, whether it came from Supabase or the static fallback in site.js.
function fromRow(r, beds) {
  const list = beds.filter((b) => b.room_id === r.id)
  return {
    id: r.id,
    category: r.category_id,
    no: r.room_no,
    floor: r.floor,
    type: r.ac_type,
    description: r.description,
    features: r.features ?? [],
    image: r.image_url || `/images/rooms/${r.id}.webp`,
    rentBasis: r.rent_basis,
    billing: r.billing_period,
    price: r.price,
    deposit: r.deposit,
    isDemoPrice: r.is_demo_price,
    isActive: r.is_active,
    beds: list,
    totalBeds: list.length,
  }
}

function fromStatic(r) {
  return {
    id: r.id, category: r.category, no: r.no, floor: r.floor, type: r.type, description: '',
    features: r.features, image: `/images/rooms/${r.id}.webp`, rentBasis: r.rentBasis, billing: r.billing,
    price: r.price, deposit: r.deposit, isDemoPrice: true, isActive: true,
    beds: null, totalBeds: r.beds, // null beds = availability unknown (no backend)
  }
}

export async function loadCatalog() {
  if (!isConfigured) {
    return {
      live: false,
      categories: staticCategories,
      rooms: staticRooms.map(fromStatic),
      amenities: staticAmenities.map((a) => ({ id: a.title, title: a.title, text: a.text, icon: a.icon, image: a.image })),
    }
  }
  const [cats, rms, beds, ams] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('rooms').select('*').eq('is_active', true).order('room_no'),
    supabase.from('beds').select('id, room_id, label, status, is_occupied').order('label'),
    supabase.from('amenities').select('*').order('sort_order'),
  ])
  const failed = [cats, rms, beds, ams].find((r) => r.error)
  if (failed) throw failed.error
  return {
    live: true,
    categories: cats.data,
    rooms: rms.data.map((r) => fromRow(r, beds.data)),
    amenities: ams.data.map((a) => ({ id: a.id, title: a.title, text: a.description, icon: a.icon, image: a.image_url })),
  }
}

// Calls back whenever any bed or room row changes. Returns an unsubscribe function.
export function subscribeAvailability(onChange) {
  if (!isConfigured) return () => {}
  const channel = supabase
    .channel('availability')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export async function loadPublishedReviews() {
  if (!isConfigured) return { live: false, reviews: [] }
  const { data, error } = await supabase
    .from('reviews')
    .select('id, author_name, rating, body, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) throw error
  return { live: true, reviews: data }
}

// ---- derived values (pure, no network)

// 'unknown' when there is no backend; otherwise how full the room is
export function availability(room) {
  if (!room.beds) return { status: 'unknown', free: null, total: room.totalBeds }
  const free = room.beds.filter((b) => !b.is_occupied && b.status === 'available').length
  const taken = room.beds.filter((b) => b.is_occupied).length
  const total = room.beds.length
  // whole-room rentals are only bookable when every bed is free
  const bookable = room.rentBasis === 'room' ? free === total && total > 0 : free > 0
  let status
  if (taken === 0) status = bookable ? 'available' : 'unavailable' // unavailable = beds under maintenance
  else if (room.rentBasis === 'room' || free === 0) status = 'full'
  else status = 'partial'
  return { status, free, total, bookable }
}

export const priceLabel = (room) => {
  const unit = room.rentBasis === 'bed' ? 'bed / ' : ''
  return `₹${room.price.toLocaleString('en-IN')} / ${unit}${room.billing}`
}

// Comparable monthly figure for sorting across nightly and monthly rooms
export const monthlyEquivalent = (room) => (room.billing === 'night' ? room.price * 30 : room.price)

// 3 rooms that span the range: cheapest, middle, priciest among rooms that can be booked (or all if none)
export function previewRooms(rooms) {
  const bookable = rooms.filter((r) => availability(r).bookable !== false)
  const pool = (bookable.length >= 3 ? bookable : rooms).slice().sort((a, b) => monthlyEquivalent(a) - monthlyEquivalent(b))
  if (pool.length <= 3) return pool
  return [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]]
}
