import { useState } from 'react'

// Lazy image with fallbacks: tries src, then the same name as .jpg, then shows a soft placeholder.
export default function Img({ src, alt = '', className = '', ...rest }) {
  const jpg = src.replace(/\.(webp|png|jpeg)$/i, '.jpg')
  const [current, setCurrent] = useState(src)
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <div role="img" aria-label={alt} className={`bg-gradient-to-br from-navy/70 to-gold/60 ${className}`} />
  }

  return (
    <img
      src={current}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => (current !== jpg ? setCurrent(jpg) : setFailed(true))}
      {...rest}
    />
  )
}
