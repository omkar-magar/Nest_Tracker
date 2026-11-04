export const brand = {
  name: 'YOLO Nest',
  tagline: 'Live Better, Live Together.',
  phone: '8483878098',
  address: 'Near Hirai Sitai Mandir, Parkhe Vasti, Hinjewadi Phase 1',
  mapQuery: 'Hirai Sitai Mandir Parkhe Vasti Hinjewadi Phase 1 Pune',
  // Add real links like { label: 'Instagram', href: 'https://...' }. The footer hides this block while it is empty.
  social: [],
}

// Files go in public/images/hero/
export const heroImages = [
  '/images/hero/hero-1.jpg',
  '/images/hero/hero-2.jpg',
  '/images/hero/hero-3.jpg',
]

// image: photo of the real facility (public/images/...). Leave it out for a facility without a photo yet.
export const amenities = [
  { icon: '🛏️', title: 'AC & Non-AC rooms', text: 'Pick the room that suits your budget. Both are furnished and cleaned regularly.', image: '/images/rooms/pg-101.webp' },
  { icon: '🎮', title: 'Gaming zone', text: 'A common gaming area to unwind with your housemates.', image: '/images/hero/gaming.webp' },
  { icon: '🏋️', title: 'Gym', text: 'An in-house gym in the common area. No separate membership.', image: '/images/hero/gym.webp' },
  { icon: '🏓', title: 'Pickleball court', text: 'Play a game after work without leaving the building.', image: '/images/hero/pickleball.webp' },
  { icon: '☕', title: 'Chill café area', text: 'A relaxed corner for coffee, work calls and conversation.', image: '/images/hero/cafe.webp' },
  { icon: '💂', title: 'Security guard', text: 'Guard on duty so you and your belongings stay safe.' },
]

// Image for each category: public/images/categories/<id>.jpg
export const categories = [
  { id: 'monthly-pg', name: 'Monthly PG', tag: 'From ₹6,500 / month' },
  { id: 'daily-pg', name: 'Daily PG', tag: 'From ₹700 / night' },
  { id: 'flat-1bhk', name: '1BHK Flat', tag: 'Furnished or empty' },
  { id: 'lodge', name: 'Lodge Rooms', tag: 'From ₹1,200 / night' },
  { id: 'airbnb', name: 'Airbnb-style Stay', tag: 'From ₹2,500 / night' },
]

// Room photo: public/images/rooms/<id>.webp   360 photo: public/images/360/<id>.jpg
// With Supabase connected, rooms come from the database (supabase/seed.sql is the seed copy of this list).
// This list is only the fallback when Supabase is not configured.
// rentBasis: 'bed' = price per bed, 'room' = price for the whole room.   billing: 'month' | 'night'.
// Prices and deposits below are demo values. Replace with the client's real prices.
export const rooms = [
  { id: 'pg-101', category: 'monthly-pg', no: '101', floor: 1, type: 'AC', beds: 2, rentBasis: 'bed', billing: 'month', price: 7500, deposit: 7500, features: ['AC', 'Furnished'] },
  { id: 'pg-102', category: 'monthly-pg', no: '102', floor: 1, type: 'Non-AC', beds: 3, rentBasis: 'bed', billing: 'month', price: 6500, deposit: 6500, features: ['Furnished'] },
  { id: 'dpg-201', category: 'daily-pg', no: '201', floor: 2, type: 'AC', beds: 2, rentBasis: 'bed', billing: 'night', price: 800, deposit: 0, features: ['AC', 'Furnished'] },
  { id: 'flat-301', category: 'flat-1bhk', no: '301', floor: 3, type: 'AC', beds: 2, rentBasis: 'room', billing: 'month', price: 18000, deposit: 18000, features: ['AC', 'Furnished'] },
  { id: 'lodge-401', category: 'lodge', no: '401', floor: 4, type: 'AC', beds: 2, rentBasis: 'room', billing: 'night', price: 1500, deposit: 0, features: ['AC'] },
  { id: 'stay-501', category: 'airbnb', no: '501', floor: 5, type: 'AC', beds: 4, rentBasis: 'room', billing: 'night', price: 3200, deposit: 0, features: ['AC', 'Furnished'] },
]

// Common questions. The answers describe how this site works. Check the policy ones (cancellation,
// deposits, check-in) with the owner and edit the wording here.
export const faqs = [
  { group: 'Booking', q: 'How do I book a bed or room?', a: 'Create a customer account, open Rooms, pick a room with free beds and choose your dates. Your beds are held for 30 minutes while you pay the first bills from your dashboard.' },
  { group: 'Booking', q: 'What if I do not pay within the hold time?', a: 'The hold is released and the beds go back on sale. You can book again at any time.' },
  { group: 'Payments', q: 'How do I pay?', a: 'Bills appear in your dashboard with a due date. Pay each one online from there. Your payment history and outstanding balance are always visible.' },
  { group: 'Payments', q: 'When is rent due?', a: 'For monthly stays, the next month\'s bill is created as soon as the current one is paid. Overdue bills are marked in your dashboard.' },
  { group: 'Security deposits', q: 'Is there a security deposit?', a: 'Monthly rooms carry a security deposit, shown on each room before you book. Nightly stays do not need one.' },
  { group: 'Accommodation', q: 'What is the difference between bed-wise and whole-room stays?', a: 'PG rooms are rented per bed and shared. Flats, lodge rooms and the Airbnb-style stay are rented as a whole room, so one booking takes every bed.' },
  { group: 'Amenities', q: 'What facilities can residents use?', a: 'A gym, gaming zone, pickleball court and café area, with a security guard on duty. See the Amenities page for photos.' },
  { group: 'Check-in and check-out', q: 'How do I choose my check-in and check-out dates?', a: 'You pick them while booking. Nightly stays need both dates. For early or late arrival, call us.' },
  { group: 'Cancellation', q: 'Can I cancel a booking?', a: 'You can cancel an unpaid hold yourself from your dashboard. For a paid stay, contact the PG office and we will help you.' },
]

// Places shown on the map in the hero (one per icon, 6 max).
// icon: metro | work | home | cart | mall | food (each has its own spot on the map).
// km: approximate distance range.  featured: shown first.  image: optional photo for the info card
// (put the file in public/images/nearby/).  label: how the name wraps on the map (one entry per line).
export const nearby = [
  { name: 'D-Mart, Hinjewadi', icon: 'cart', km: '1–2', note: 'Groceries and daily needs.', image: '/images/nearby/dmart-xion.jpg', featured: true },
  { name: 'Xion Mall', icon: 'mall', km: '1.5–2.5', note: 'Shopping, multiplex and food court.', image: '/images/nearby/xion.jpg' },
  { name: 'Blue Ridge Township', label: ['Blue Ridge', 'Township'], icon: 'home', km: '4–6', note: 'Large township with offices and homes.', image: '/images/nearby/blue-ridge.jpg' },
  { name: 'Rajiv Gandhi Infotech Park', label: ['Rajiv Gandhi', 'Infotech Park'], icon: 'work', km: '4–6', note: 'Short commute to the IT parks.', image: '/images/nearby/infotech.jpg' },
  { name: 'Balewadi High Street', label: ['Balewadi', 'High Street'], icon: 'food', km: '7–9', note: 'Popular for cafés, food and nightlife.', image: '/images/nearby/balewadi.jpg' },
  { name: 'Hinjawadi Phase 1 Metro Station', label: ['Hinjawadi Phase 1', 'Metro Station'], icon: 'metro', km: '4–6', note: 'Quick hop to the rest of Pune.', image: '/images/nearby/metro.jpg' },
]
