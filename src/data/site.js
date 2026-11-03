export const brand = {
  name: 'YOLO Nest',
  tagline: 'Live Better, Live Together.',
  phone: '8483878098',
  address: 'Near Hirai Sitai Mandir, Parkhe Vasti, Hinjewadi Phase 1',
  mapQuery: 'Hirai Sitai Mandir Parkhe Vasti Hinjewadi Phase 1 Pune',
}

// Files go in public/images/hero/
export const heroImages = [
  '/images/hero/hero-1.jpg',
  '/images/hero/hero-2.jpg',
  '/images/hero/hero-3.jpg',
]

export const amenities = [
  { icon: '🛏️', title: 'AC & Non-AC rooms', text: 'Pick the room that suits your budget. Both are furnished and cleaned regularly.' },
  { icon: '🎮', title: 'Gaming zone', text: 'A common gaming area to unwind with your housemates.' },
  { icon: '🏋️', title: 'Gym', text: 'An in-house gym in the common area. No separate membership.' },
  { icon: '🏓', title: 'Pickleball court', text: 'Play a game after work without leaving the building.' },
  { icon: '☕', title: 'Chill café area', text: 'A relaxed corner for coffee, work calls and conversation.' },
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

// Room photo: public/images/rooms/<id>.jpg   360 photo: public/images/360/<id>.jpg
// Prices below are demo values. Replace with the client's real prices.
export const rooms = [
  { id: 'pg-101', category: 'monthly-pg', no: '101', floor: 1, type: 'AC', beds: 2, price: '₹7,500 / bed / month' },
  { id: 'pg-102', category: 'monthly-pg', no: '102', floor: 1, type: 'Non-AC', beds: 3, price: '₹6,500 / bed / month' },
  { id: 'dpg-201', category: 'daily-pg', no: '201', floor: 2, type: 'AC', beds: 2, price: '₹800 / bed / night' },
  { id: 'flat-301', category: 'flat-1bhk', no: '301', floor: 3, type: 'AC', beds: 2, price: '₹18,000 / month' },
  { id: 'lodge-401', category: 'lodge', no: '401', floor: 4, type: 'AC', beds: 2, price: '₹1,500 / night' },
  { id: 'stay-501', category: 'airbnb', no: '501', floor: 5, type: 'AC', beds: 4, price: '₹3,200 / night' },
]

// Places shown on the 3D map in the hero (max 5, in this order).
// icon: metro | hospital | work | cart | food.  km: approximate distance.  featured: shown first.
// TODO: replace the placeholder names/distances with the real ones.
export const nearby = [
  { name: 'Metro station', icon: 'metro', km: 'x', note: 'Quick hop to the rest of Pune.' },
  { name: 'Hospital', icon: 'hospital', km: 'x', note: 'Medical help close by.' },
  { name: 'Hinjewadi IT parks', icon: 'work', km: 'x', note: 'Short commute to Phase 1, 2 and 3.' },
  { name: 'Supermarket', icon: 'cart', km: 'x', note: 'Groceries and daily needs.' },
  { name: 'Balewadi High Street', icon: 'food', km: '4.6', note: 'Popular for cafés, food and nightlife.', featured: true },
]
