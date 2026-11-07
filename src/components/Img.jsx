import { useState } from 'react'

// Lazy image with fallbacks: tries src, then the same name as .jpg, then shows a soft placeholder.
// - a pale block shows until the photo arrives (no blank gap)
// - priority: for the one or two photos at the top of the page. Loads at once instead of lazily.
// - pass srcSet / sizes for responsive files; they are dropped if the file fails and the fallback takes over.
export default function Img({ src, alt = '', className = '', priority = false, srcSet, ...rest }) {
  const jpg = src.replace(/\.(webp|png|jpeg)$/i, '.jpg')
  const [current, setCurrent] = useState(src)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (failed) {
    return <div role="img" aria-label={alt} className={`bg-gradient-to-br from-navy/70 to-gold/60 ${className}`} />
  }

  return (
    <img
      src={current}
      srcSet={current === src ? srcSet : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={`${className} ${loaded ? '' : 'bg-navy/5'}`}
      onLoad={() => setLoaded(true)}
      onError={() => (current !== jpg ? setCurrent(jpg) : setFailed(true))}
      {...rest}
    />
  )
}
