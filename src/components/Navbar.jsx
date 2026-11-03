const links = [['Amenities', 'amenities'], ['Stays', 'stays'], ['Location', 'location'], ['Contact', 'contact']]

export default function Navbar({ user, go, scrollTo, logout }) {
  return (
    <header className="sticky top-0 z-40 border-b border-navy/10 bg-cream/90 text-navy backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <button onClick={() => go('home')} className="flex items-center gap-2" aria-label="YOLO nest home">
          <img src="/images/logo.png" alt="" className="h-9 w-auto mix-blend-multiply" />
          <span className="flex flex-col text-left leading-none">
            <span className="text-lg font-extrabold tracking-tight">YOLO</span>
            <span className="-mt-0.5 text-sm font-semibold tracking-[0.2em] text-gold">nest</span>
          </span>
        </button>
        <nav className="hidden gap-7 text-[15px] text-navy/80 md:flex">
          {links.map(([label, id]) => (
            <button key={id} onClick={() => scrollTo(id)} className="transition-colors hover:text-navy">{label}</button>
          ))}
        </nav>
        <div className="flex gap-2 text-sm">
          {user ? (
            <>
              <button onClick={() => go('dashboard')} className="rounded-full bg-navy px-5 py-2 font-semibold text-white">Dashboard</button>
              <button onClick={logout} className="rounded-full border border-navy/30 px-5 py-2 font-medium">Log out</button>
            </>
          ) : (
            <button onClick={() => go('login')} className="rounded-full bg-navy px-5 py-2 font-semibold text-white transition-colors hover:bg-navy/90">Log in</button>
          )}
        </div>
      </div>
    </header>
  )
}
