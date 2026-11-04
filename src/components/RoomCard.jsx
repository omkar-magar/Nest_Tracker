import Img from './Img'
import { Badge, Button } from './ui'
import { availability, priceLabel } from '../services/catalog'
import { rupees } from '../services/format'

const STATUS = {
  available: { tone: 'green', text: 'Available' },
  partial: { tone: 'amber', text: 'Partially occupied' },
  full: { tone: 'red', text: 'Fully booked' },
  unavailable: { tone: 'gray', text: 'Unavailable' },
  unknown: { tone: 'gray', text: 'Availability not connected' },
}

export function AvailabilityBadge({ room }) {
  const a = availability(room)
  return <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].text}</Badge>
}

export default function RoomCard({ room, categoryName }) {
  const a = availability(room)
  const occupancy =
    a.status === 'unknown'
      ? `${room.totalBeds} beds`
      : room.rentBasis === 'room'
        ? `${a.total} beds, whole room`
        : `${a.free} of ${a.total} beds free`

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white">
      <Img src={room.image} alt={`Room ${room.no}, ${room.type}`} className="h-44 w-full object-cover" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-navy">Room {room.no}</h3>
            <p className="text-xs text-slate-500">{categoryName} · Floor {room.floor}</p>
          </div>
          <AvailabilityBadge room={room} />
        </div>

        <p className="mt-3 text-lg font-bold text-navy">{priceLabel(room)}</p>
        {room.deposit > 0 && <p className="text-xs text-slate-500">Deposit {rupees(room.deposit)}</p>}
        <p className="mt-1 text-sm text-slate-600">{occupancy}</p>

        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Features">
          {[room.type, ...room.features.filter((f) => f !== room.type)].map((f) => (
            <li key={f} className="rounded-full bg-cream px-2.5 py-0.5 text-xs text-navy/80">{f}</li>
          ))}
        </ul>

        <div className="mt-auto pt-4">
          {a.bookable === false ? (
            <Button variant="outline" className="w-full" disabled>{a.status === 'unavailable' ? 'Unavailable' : 'Fully booked'}</Button>
          ) : (
            <Button variant="sun" className="w-full" to={`/book/${room.id}`}>Book this room</Button>
          )}
        </div>
      </div>
    </article>
  )
}
