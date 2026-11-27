import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Card, Notice, PageHeader } from '../components/ui'
import { canInstall, detectPlatform, isInstalled, promptInstall, subscribe } from '../lib/installPrompt'

const TABS = [
  ['android', 'Android'],
  ['ios', 'iPhone & iPad'],
  ['desktop', 'Desktop'],
]

const STEPS = {
  android: [
    'Open this page in Chrome.',
    'Tap the ⋮ menu at the top right.',
    'Tap “Install app” (or “Add to Home screen”), then “Install”.',
    'Open YOLO Nest from your home screen or app drawer.',
  ],
  ios: [
    'Open this page in Safari.',
    'Tap the Share button (the square with an arrow pointing up) in the toolbar.',
    'Scroll down and tap “Add to Home Screen”.',
    'Keep the name “YOLO Nest” and tap “Add”. The app appears on your home screen.',
  ],
  desktop: [
    'Chrome or Edge: click the install icon at the right end of the address bar, then “Install”.',
    'No icon? Chrome: ⋮ menu → “Cast, save and share” → “Install page as app”. Edge: … menu → “Apps” → “Install this site as an app”.',
    'Safari on Mac (macOS Sonoma or later): File → “Add to Dock”.',
    'Firefox cannot install apps: open this page in Chrome, Edge or Safari instead.',
  ],
}

const NOTES = {
  ios: 'Apple does not allow installing from a download button, so it has to be added from the Share menu. Notifications work once the app is on your home screen (iOS 16.4 or later).',
  android: 'No Play Store needed: the app installs straight from this website and updates itself when you open it.',
  desktop: 'The app opens in its own window and can be pinned to the taskbar or Dock.',
}

function useInstallState() {
  const can = useSyncExternalStore(subscribe, canInstall, () => false)
  const done = useSyncExternalStore(subscribe, isInstalled, () => false)
  return { can, done }
}

export default function Download() {
  const [tab, setTab] = useState('android')
  const [msg, setMsg] = useState('')
  const { can, done } = useInstallState()

  useEffect(() => { setTab(detectPlatform()) }, [])

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'dismissed') setMsg('Install cancelled. You can try again any time.')
    if (outcome === 'unavailable') setMsg('Your browser did not offer an install. Follow the steps below instead.')
  }

  const showButton = tab !== 'ios'

  return (
    <>
      <PageHeader title="Get the YOLO Nest app" intro="Install YOLO Nest on your phone or computer: rooms, bookings, bills and complaints in one tap, no app store needed." />
      <div className="mx-auto w-full max-w-6xl px-4 py-10 text-navy">
        <section id="install" className="scroll-mt-16">
          <div role="tablist" aria-label="Your device" className="flex flex-wrap gap-2">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="install-panel"
                onClick={() => { setTab(id); setMsg('') }}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${tab === id ? 'bg-navy text-white' : 'border border-navy/30 text-navy hover:bg-navy/5'}`}>
                {label}
              </button>
            ))}
          </div>

          <div id="install-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-6 grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="flex items-center gap-4">
                <img src="/icons/public-192.png" alt="" className="h-16 w-16 rounded-2xl border border-navy/10" />
                <div>
                  <h2 className="text-xl font-bold">YOLO Nest</h2>
                  <p className="text-sm text-slate-600">Co-living, Hinjewadi Phase 1, Pune</p>
                </div>
              </div>

              {done ? (
                <div className="mt-5"><Notice tone="ok">The app is installed on this device. Open it from your home screen, app list or Dock.</Notice></div>
              ) : showButton && (
                <div className="mt-5">
                  {can ? (
                    <Button variant="sun" onClick={install}>{tab === 'android' ? 'Download for Android' : 'Install on this computer'}</Button>
                  ) : (
                    <p className="text-sm text-slate-600">
                      {tab === 'android' ? 'On an Android phone in Chrome, a “Download for Android” button appears here.' : 'In Chrome or Edge, an “Install” button appears here.'}
                      {' '}If it does not, use the steps below.
                    </p>
                  )}
                  {msg && <p role="status" className="mt-3 text-sm text-slate-600">{msg}</p>}
                </div>
              )}

              <h3 className="mt-6 font-semibold">{tab === 'ios' ? 'Add to your home screen' : 'Install by hand'}</h3>
              <ol className="mt-3 space-y-3">
                {STEPS[tab].map((s, i) => (
                  <li key={s} className="flex gap-3 text-sm text-slate-700">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-navy" aria-hidden="true">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-xs text-slate-500">{NOTES[tab]}</p>
            </Card>

            <Card className="lg:col-span-2">
              <h2 className="font-semibold">What you get</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                <li>Browse rooms and live bed availability</li>
                <li>Book and pay online</li>
                <li>See your bills and raise complaints</li>
                <li>Notifications from the PG</li>
              </ul>
              <h2 className="mt-6 font-semibold">Staff and managers</h2>
              <p className="mt-2 text-sm text-slate-600">Your work app installs separately. Open your login page on your phone, then use the same steps from there.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" to="/staff/login">Staff login</Button>
                <Button variant="outline" to="/admin/login">Admin login</Button>
              </div>
            </Card>
          </div>
        </section>
      </div>
    </>
  )
}
