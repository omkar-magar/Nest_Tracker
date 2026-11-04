import { Link } from 'react-router-dom'
import useAsync from '../hooks/useAsync'
import { loadPublishedReviews } from '../services/catalog'
import { formatDate } from '../services/format'
import { Empty, ErrorBox, Spinner } from './ui'

const Stars = ({ n }) => (
  <p aria-label={`${n} out of 5 stars`} className="text-gold">
    <span aria-hidden="true">{'★'.repeat(n)}<span className="text-navy/20">{'★'.repeat(5 - n)}</span></span>
  </p>
)

// Shows only reviews a real customer wrote and the owner published. Nothing is pre-filled.
export default function Reviews() {
  const { data, error, loading, reload } = useAsync(loadPublishedReviews, [])

  if (loading) return <Spinner label="Loading reviews" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data.reviews.length) {
    return (
      <Empty title="No reviews yet">
        {data.live
          ? <>Residents can leave a review from their <Link className="font-medium underline" to="/account">dashboard</Link> after their stay begins.</>
          : 'Reviews appear here once the site is connected to its database.'}
      </Empty>
    )
  }
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {data.reviews.map((r) => (
        <li key={r.id} className="rounded-2xl border border-navy/10 bg-white p-5">
          <Stars n={r.rating} />
          <p className="mt-2 text-sm text-slate-700">“{r.body}”</p>
          <p className="mt-3 text-sm font-semibold">{r.author_name}</p>
          <p className="text-xs text-slate-500">{formatDate(r.created_at)}</p>
        </li>
      ))}
    </ul>
  )
}
