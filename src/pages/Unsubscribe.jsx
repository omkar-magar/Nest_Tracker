import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Notice, Spinner } from '../components/ui'
import { rpc } from '../services/manage'

// Opt-out link at the end of every bulk message (PRD 9.2)
export default function Unsubscribe() {
  const [params] = useSearchParams()
  const [state, setState] = useState('working')
  useEffect(() => {
    const t = params.get('t')
    if (!t) { setState('bad'); return }
    rpc('unsubscribe', { p_token: t }).then((ok) => setState(ok ? 'done' : 'bad')).catch(() => setState('bad'))
  }, [params])
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-navy">
      <h1 className="mb-4 text-2xl font-bold">Unsubscribe</h1>
      {state === 'working' && <Spinner label="Updating" />}
      {state === 'done' && <Notice tone="ok">Done. You will not get offers or announcements from us any more.</Notice>}
      {state === 'bad' && <Notice tone="warn">This link is not valid. Reply STOP or call us and we will remove your number.</Notice>}
    </div>
  )
}
