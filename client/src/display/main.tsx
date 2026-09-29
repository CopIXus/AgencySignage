import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicPayload } from '@shared/types'
import { ScreenView } from '../ScreenView'
import '../stage.css'

const slug = location.pathname.split('/').filter(Boolean)[1] || ''
const preview = new URLSearchParams(location.search).get('preview') === '1'
const deviceKey = 'signage-player'

function App() {
  const [payload, setPayload] = useState<PublicPayload | null>(null)
  const [tone, setTone] = useState(false)
  const [logo, setLogo] = useState(false)
  const version = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState('translate(-50%, -50%)')

  useEffect(() => {
    const cached = localStorage.getItem(`signage:${slug}`)
    if (cached && !preview) setPayload(JSON.parse(cached) as PublicPayload)
    let stop = false
    const playerId = localStorage.getItem(deviceKey) || crypto.randomUUID()
    localStorage.setItem(deviceKey, playerId)
    const deviceName = localStorage.getItem('signage-device-name') || 'Display'
    const pull = async (load: boolean) => {
      const params = new URLSearchParams()
      if (preview) params.set('preview', '1')
      else {
        params.set('version', String(version.current))
        params.set('playerId', playerId)
        params.set('deviceName', deviceName)
        params.set('width', String(window.innerWidth))
        params.set('height', String(window.innerHeight))
        params.set('dpr', String(window.devicePixelRatio || 1))
        if (load) params.set('load', '1')
      }
      const response = await fetch(`/api/public/screens/${slug}?${params}`)
      if (!response.ok) return
      const body = await response.json()
      if (body.unchanged) {
        setPayload((current) => current ? { ...current, serverNow: body.serverNow, weather: body.weather } : current)
        return
      }
      version.current = body.version
      if (!preview) localStorage.setItem(`signage:${slug}`, JSON.stringify(body))
      setPayload(body)
    }
    void pull(true)
    const timer = window.setInterval(() => { if (!stop && !preview) void pull(false) }, 10000)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) return
      if (event.data?.type === 'signage-refresh') void pull(false)
      if (event.data?.type === 'signage-burn') {
        if (event.data.mode === 'logo') flashLogo()
        if (event.data.mode === 'tone') flashTone()
      }
    }
    window.addEventListener('message', onMessage)
    return () => { stop = true; window.clearInterval(timer); window.removeEventListener('message', onMessage) }
  }, [])

  useEffect(() => {
    if (!payload) return
    const measure = () => {
      const viewW = preview ? payload.mode.width : window.innerWidth
      const viewH = preview ? payload.mode.height : window.innerHeight
      const canvasW = payload.mode.width
      const canvasH = payload.mode.height
      const viewWide = viewW >= viewH
      const canvasWide = canvasW >= canvasH
      const turn = viewWide === canvasWide || payload.turn === 'none' ? 0 : payload.turn === 'clockwise' ? 90 : -90
      const visW = turn === 0 ? canvasW : canvasH
      const visH = turn === 0 ? canvasH : canvasW
      const scale = Math.min(viewW / visW, viewH / visH)
      setTransform(`translate(-50%, -50%) rotate(${turn}deg) scale(${scale})`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [payload])

  useEffect(() => {
    if (!payload || preview) return
    const burn = payload.presentation.burnIn
    const timers: number[] = []
    if (burn.logo) timers.push(window.setInterval(flashLogo, burn.logoEveryMinutes * 60 * 1000))
    if (burn.tone) timers.push(window.setInterval(flashTone, burn.toneEveryMinutes * 60 * 1000))
    return () => timers.forEach((timer) => window.clearInterval(timer))
  }, [payload, preview])

  function flashLogo() {
    setLogo(true)
    window.dispatchEvent(new CustomEvent('signage-hold', { detail: true }))
    window.setTimeout(() => {
      setLogo(false)
      window.dispatchEvent(new CustomEvent('signage-hold', { detail: false }))
    }, (payload?.presentation.burnIn.logoSeconds || 8) * 1000)
  }
  function flashTone() {
    setTone(true)
    window.setTimeout(() => setTone(false), ((payload?.presentation.burnIn.toneFadeSeconds || 30) * 2 + (payload?.presentation.burnIn.toneHoldSeconds || 45)) * 1000)
  }

  if (!payload) return <div className="stage-root" />
  const seal = payload.presentation.burnIn.logoMediaId || payload.branding.sealMediaId
  return (
    <div className={`stage-root ${preview ? 'previewing' : ''}`} ref={box}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform }}>
        <div className={tone ? 'tone-on' : ''} style={{ transition: `filter ${payload.presentation.burnIn.toneFadeSeconds}s linear` }}>
          <ScreenView payload={payload} preview={preview} onEdit={(path, value) => {
            if (window.parent !== window) window.parent.postMessage({ type: 'signage-edit', path, value }, location.origin)
          }} />
        </div>
      </div>
      {logo ? <div className="logo-rest">{seal ? <img src={`/media/${seal}`} alt="" /> : <div className="seal-mark">STAR</div>}</div> : null}
      <style>{`.tone-on .canvas { background: var(--light-bg); color: var(--light-ink); }`}</style>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
