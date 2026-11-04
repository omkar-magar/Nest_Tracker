import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// One bundle, three installable apps. Which one the browser offers to install depends on the <link rel="manifest">
// of the page you are on, so we point it at the right manifest by URL area (each has its own scope and start_url).
const IDENTITIES = {
  admin: { manifest: '/manifest-admin.webmanifest', title: 'YOLO Admin', color: '#1c1f4a', icon: '/icons/admin-192.png' },
  staff: { manifest: '/manifest-staff.webmanifest', title: 'YOLO Staff', color: '#1c1f4a', icon: '/icons/staff-192.png' },
  public: { manifest: '/manifest.webmanifest', title: 'YOLO Nest', color: '#fbfaf6', icon: '/icons/public-192.png' },
}

const area = (path) => (path.startsWith('/admin') ? 'admin' : path.startsWith('/staff') ? 'staff' : 'public')

function setHead(selector, create, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement(create)
    document.head.appendChild(el)
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
}

export default function usePwaIdentity() {
  const { pathname } = useLocation()
  useEffect(() => {
    const id = IDENTITIES[area(pathname)]
    setHead('link[rel="manifest"]', 'link', { rel: 'manifest', href: id.manifest })
    setHead('meta[name="theme-color"]', 'meta', { name: 'theme-color', content: id.color })
    setHead('meta[name="apple-mobile-web-app-title"]', 'meta', { name: 'apple-mobile-web-app-title', content: id.title })
    setHead('link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', href: id.icon })
  }, [pathname])
}
