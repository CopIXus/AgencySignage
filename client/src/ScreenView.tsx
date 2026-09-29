import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { PublicPayload } from '@shared/types'
import { isTightFamily, isWideFamily } from '@shared/modes'

export function ScreenView({ payload, preview, onEdit }: { payload: PublicPayload; preview?: boolean; onEdit?: (path: string, value: string) => void }) {
  const branding = payload.branding
  const family = payload.mode.family
  const shape = isWideFamily(family) ? 'wide' : 'tall'
  const tight = isTightFamily(family) ? 'tight' : ''
  return (
    <div
      className={`canvas ${shape} ${tight} motion-${payload.presentation.motion}`}
      style={{
        width: payload.mode.width,
        height: payload.mode.height,
        ['--primary' as string]: branding.primary,
        ['--accent' as string]: branding.accent,
        ['--ink' as string]: branding.ink,
        ['--plate' as string]: branding.plate,
        ['--light-bg' as string]: branding.lightBg,
        ['--light-ink' as string]: branding.lightInk,
      }}
    >
      {payload.empty ? <Seal brandingName={branding.agencyName} seal={branding.sealMediaId} /> : <Template payload={payload} preview={preview} onEdit={onEdit} />}
      <Chrome payload={payload} />
    </div>
  )
}

function Template({ payload, preview, onEdit }: { payload: PublicPayload; preview?: boolean; onEdit?: (path: string, value: string) => void }) {
  if (payload.template === 'award' && payload.award) return <Award payload={payload} preview={preview} onEdit={onEdit} />
  if (payload.template === 'directory' && payload.directory) return <Directory payload={payload} />
  if (payload.template === 'slides' && payload.slides) return <Slides payload={payload} preview={!!preview} />
  if (payload.template === 'playlist' && payload.playlist) return <Playlist payload={payload} preview={!!preview} />
  return <Seal brandingName={payload.branding.agencyName} seal={payload.branding.sealMediaId} />
}

function Award({ payload, preview, onEdit }: { payload: PublicPayload; preview?: boolean; onEdit?: (path: string, value: string) => void }) {
  const award = payload.award!
  const overflow = payload.presentation.listOverflow
  const history = award.history
  return (
    <section className="board">
      <h1 className="rise"><Editable text={award.title} enabled={!!preview} onChange={(value) => onEdit?.('title', value)} /></h1>
      <div className="honoree rise">
        <div className="portrait-photo">{award.current.photoId ? <img src={`/media/${award.current.photoId}`} alt="" /> : null}</div>
        <div>
          <h2><Editable text={award.current.name || 'Name'} enabled={!!preview} onChange={(value) => onEdit?.('current.name', value)} /></h2>
          <p>#{award.current.badgeNumber || '----'}</p>
          <p>Awarded for {award.current.awardYear || '----'}</p>
          <p>{award.current.rank}</p>
          <p>Date of hire: {award.current.hireDate}</p>
          <p>Years of service: {award.current.yearsOfService}</p>
        </div>
        <div className="badge-slot">{payload.branding.badgeMediaId ? <img src={`/media/${payload.branding.badgeMediaId}`} alt="" /> : <Seal brandingName="" seal={null} />}</div>
      </div>
      <div className="history-head">Previous recipients</div>
      <FitList className="plates" items={history} scroll={overflow === 'slow-scroll'} seconds={payload.presentation.scrollSecondsPerRow} render={(item) => (
        <article className="plate" key={item.id}><strong>{item.name}</strong><span>#{item.badgeNumber} · {item.awardYear}</span></article>
      )} />
      <footer className="board-foot"><span>{payload.branding.agencyName}</span><span>{payload.branding.sheriffLine}</span></footer>
    </section>
  )
}

function Directory({ payload }: { payload: PublicPayload }) {
  const cards = payload.directory!.cards
  return (
    <section className="directory">
      <h1 className="rise">{payload.directory!.title}</h1>
      <FitList className="cards" items={cards} scroll={payload.presentation.listOverflow === 'slow-scroll'} seconds={payload.presentation.scrollSecondsPerRow} render={(card) => (
        <article className="card" key={card.id}>
          {card.logoId ? <img className="card-logo" src={`/media/${card.logoId}`} alt="" /> : null}
          <strong>{card.name}</strong>
          <span>{card.subtitle}</span>
          <span>{card.phone}</span>
          <span>{card.details}</span>
        </article>
      )} />
    </section>
  )
}

function Slides({ payload, preview }: { payload: PublicPayload; preview: boolean }) {
  const slides = payload.slides!.slides
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (preview || slides.length < 2) return
    const delay = (slides[index]?.durationSec || 12) * 1000
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % slides.length), delay)
    return () => window.clearTimeout(timer)
  }, [index, slides, preview])
  const slide = slides[index]
  if (!slide) return <Seal brandingName={payload.branding.agencyName} seal={payload.branding.sealMediaId} />
  const side = !isWideFamily(payload.mode.family)
  return (
    <section className="slide rise" style={slide.imageId ? { backgroundImage: `linear-gradient(rgba(6,16,28,.55), rgba(6,16,28,.55)), url(/media/${slide.imageId})` } : undefined}>
      <div className={side ? 'slide-row' : 'slide-row'} style={side ? { gridTemplateColumns: '1fr' } : undefined}>
        <div>
          <h1>{slide.title}</h1>
          <div className="body" dangerouslySetInnerHTML={{ __html: slide.bodyHtml || '' }} />
        </div>
        {slide.qrUrl ? <Qr url={slide.qrUrl} label={slide.qrLabel} /> : null}
      </div>
    </section>
  )
}

function Playlist({ payload, preview }: { payload: PublicPayload; preview: boolean }) {
  const playlist = payload.playlist!
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState(1)
  const [hold, setHold] = useState(false)
  const entries = playlist.entries
  const override = playlist.override
  useEffect(() => {
    if (preview || override || entries.length === 0) return
    const duration = (entries[index]?.durationSec || 15) * 1000
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      if (hold) return
      const left = 1 - Math.min(1, (now - started) / duration)
      setProgress(left)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const timer = window.setTimeout(() => {
      setIndex((value) => (value + 1) % entries.length)
      setProgress(1)
    }, duration)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [index, entries, preview, override, hold])
  useEffect(() => {
    const onHold = (event: Event) => setHold((event as CustomEvent<boolean>).detail)
    window.addEventListener('signage-hold', onHold)
    return () => window.removeEventListener('signage-hold', onHold)
  }, [])
  if (override) {
    if (override.payload) return <ScreenView payload={{ ...override.payload, presentation: { ...override.payload.presentation, progress: false } }} />
    return <section className="slide"><h1>{override.title}</h1><div className="body"><p>{override.body}</p></div></section>
  }
  const entry = entries[index]
  if (!entry) return <Seal brandingName={payload.branding.agencyName} seal={payload.branding.sealMediaId} />
  return (
    <>
      <ScreenView payload={{ ...entry.payload, presentation: { ...entry.payload.presentation, progress: false, showClock: false, showWeather: false } }} />
      {payload.presentation.progress && !hold ? (
        <>
          <div className="progress-line"><span style={{ transform: `scaleX(${progress})` }} /></div>
          <div className="progress-chip">{index + 1} of {entries.length} · {formatLeft(progress * entry.durationSec)}</div>
        </>
      ) : null}
    </>
  )
}

function Chrome({ payload }: { payload: PublicPayload }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!payload.presentation.showClock) return
    const base = new Date(payload.serverNow).getTime()
    const started = Date.now()
    const tick = () => {
      const time = new Date(base + (Date.now() - started))
      setText(new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone, hour: 'numeric', minute: '2-digit' }).format(time))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [payload.serverNow, payload.timezone, payload.presentation.showClock])
  if (!payload.presentation.showClock && !payload.weather) return null
  return (
    <div className="footer-chrome">
      {payload.presentation.showClock ? <span>{text}</span> : null}
      {payload.weather ? <span>{payload.weather.tempF}° {payload.weather.condition}</span> : null}
    </div>
  )
}

function Seal({ brandingName, seal }: { brandingName: string; seal: string | null }) {
  return (
    <div className="seal-only">
      {seal ? <img src={`/media/${seal}`} alt="" style={{ width: '22%' }} /> : <div className="seal-mark">STAR</div>}
      <div>{brandingName}</div>
    </div>
  )
}

function Qr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { void QRCode.toDataURL(url, { margin: 1, width: 512 }).then(setSrc) }, [url])
  return <figure className="qr-block">{src ? <img src={src} alt="" /> : null}<figcaption>{label}</figcaption></figure>
}

function Editable({ text, enabled, onChange }: { text: string; enabled: boolean; onChange: (value: string) => void }) {
  if (!enabled) return <>{text}</>
  return <span contentEditable suppressContentEditableWarning onBlur={(event) => onChange(event.currentTarget.textContent || '')}>{text}</span>
}

function FitList<T extends { id: string }>({ items, className, scroll, seconds, render }: { items: T[]; className: string; scroll: boolean; seconds: number; render: (item: T) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let low = 0.45
    let high = 1
    let best = 0.45
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2
      el.style.setProperty('--fit', String(mid))
      const fits = el.scrollHeight <= el.clientHeight + 2
      if (fits) { best = mid; low = mid } else high = mid
    }
    setScale(best)
    setOverflows(scroll && best < 0.72)
  }, [items, scroll, className])
  const shown = overflows ? [...items, ...items] : items
  return (
    <div className={`history-window ${overflows ? 'fade' : ''}`} ref={ref}>
      <div className={className} style={{ ['--fit' as string]: String(overflows ? 0.78 : scale) }}>
        <div className={overflows ? 'scroll-track' : undefined} style={overflows ? { animationDuration: `${Math.max(items.length, 1) * seconds}s` } : undefined}>
          <div className={className}>{shown.map((item, index) => <div key={`${item.id}-${index}`}>{render(item)}</div>)}</div>
        </div>
      </div>
    </div>
  )
}

function formatLeft(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
