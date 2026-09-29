import { qrDataUrl } from './qr.js'

const slug = location.pathname.split('/').filter(Boolean)[1] || ''
const preview = new URLSearchParams(location.search).get('preview') === '1'
const root = document.querySelector('#root')
let payload = null
let version = 0
let tone = false
let logo = false
let hold = false

const playerId = localStorage.getItem('signage-player') || crypto.randomUUID()
localStorage.setItem('signage-player', playerId)

if (!preview) {
  const cached = localStorage.getItem(`signage:${slug}`)
  if (cached) { payload = JSON.parse(cached); paint() }
}
pull(true)
if (!preview) setInterval(() => pull(false), 10000)
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return
  if (event.data?.type === 'signage-refresh') pull(false)
  if (event.data?.type === 'signage-burn' && event.data.mode === 'logo') flashLogo()
  if (event.data?.type === 'signage-burn' && event.data.mode === 'tone') flashTone()
})
window.addEventListener('resize', paint)
window.addEventListener('signage-hold', (event) => { hold = event.detail })

async function pull(load) {
  const params = new URLSearchParams()
  if (preview) params.set('preview', '1')
  else {
    params.set('version', String(version))
    params.set('playerId', playerId)
    params.set('deviceName', localStorage.getItem('signage-device-name') || 'Display')
    params.set('width', String(window.innerWidth))
    params.set('height', String(window.innerHeight))
    params.set('dpr', String(window.devicePixelRatio || 1))
    if (load) params.set('load', '1')
  }
  const response = await fetch(`/api/public/screens/${slug}?${params}`)
  if (!response.ok) return
  const body = await response.json()
  if (body.unchanged) {
    if (payload) { payload.serverNow = body.serverNow; payload.weather = body.weather; paintChrome() }
    return
  }
  version = body.version || 0
  payload = body
  if (!preview) localStorage.setItem(`signage:${slug}`, JSON.stringify(body))
  paint()
  scheduleBurn()
}

let burnTimers = []
function scheduleBurn() {
  burnTimers.forEach(clearInterval)
  burnTimers = []
  if (!payload || preview) return
  const burn = payload.presentation.burnIn
  if (burn.logo) burnTimers.push(setInterval(flashLogo, burn.logoEveryMinutes * 60 * 1000))
  if (burn.tone) burnTimers.push(setInterval(flashTone, burn.toneEveryMinutes * 60 * 1000))
}
function flashLogo() {
  logo = true
  window.dispatchEvent(new CustomEvent('signage-hold', { detail: true }))
  paint()
  setTimeout(() => {
    logo = false
    window.dispatchEvent(new CustomEvent('signage-hold', { detail: false }))
    paint()
  }, (payload?.presentation.burnIn.logoSeconds || 8) * 1000)
}
function flashTone() {
  tone = true
  paint()
  const burn = payload.presentation.burnIn
  setTimeout(() => { tone = false; paint() }, ((burn.toneFadeSeconds || 30) * 2 + (burn.toneHoldSeconds || 45)) * 1000)
}

function paint() {
  if (!payload) { root.innerHTML = '<div class="stage-root"></div>'; return }
  const branding = payload.branding || {}
  const family = payload.mode.family
  const wide = family === '16:9' || family === '16:10' || family === '4:3'
  const tight = family === '4:3' || family === '3:4' || family === '16:10' || family === '10:16'
  const viewW = preview ? payload.mode.width : window.innerWidth
  const viewH = preview ? payload.mode.height : window.innerHeight
  const canvasWide = payload.mode.width >= payload.mode.height
  const viewWide = viewW >= viewH
  const turn = viewWide === canvasWide || payload.turn === 'none' ? 0 : payload.turn === 'clockwise' ? 90 : -90
  const visW = turn ? payload.mode.height : payload.mode.width
  const visH = turn ? payload.mode.width : payload.mode.height
  const scale = Math.min(viewW / visW, viewH / visH)
  root.innerHTML = `<div class="stage-root ${preview ? 'previewing' : ''}">
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%, -50%) rotate(${turn}deg) scale(${scale})">
      <div class="canvas ${wide ? 'wide' : 'tall'} ${tight ? 'tight' : ''} motion-${payload.presentation.motion} ${tone ? 'light' : ''}" style="width:${payload.mode.width}px;height:${payload.mode.height}px;--primary:${branding.primary};--accent:${branding.accent};--ink:${branding.ink};--plate:${branding.plate};--light-bg:${branding.lightBg};--light-ink:${branding.lightInk}">
        ${payload.empty ? seal(branding) : bodyFor(payload)}
        ${chrome()}
      </div>
    </div>
    ${logo ? `<div class="logo-rest">${(payload.presentation.burnIn.logoMediaId || branding.sealMediaId) ? `<img src="/media/${payload.presentation.burnIn.logoMediaId || branding.sealMediaId}" alt="">` : '<div class="seal-mark">STAR</div>'}</div>` : ''}
  </div>`
  bindEdits()
  fitLists()
  startPlaylist()
  startSlides()
}

function bodyFor(item) {
  if (item.template === 'award' && item.award) return award(item)
  if (item.template === 'directory' && item.directory) return directory(item)
  if (item.template === 'slides' && item.slides) return slides(item)
  if (item.template === 'playlist' && item.playlist) return playlist(item)
  return seal(item.branding)
}
function award(item) {
  const current = item.award.current || {}
  return `<section class="board">
    <h1 class="rise">${editable(item.award.title, preview, 'title')}</h1>
    <div class="honoree rise">
      <div class="portrait-photo">${current.photoId ? `<img src="/media/${current.photoId}" alt="">` : ''}</div>
      <div>
        <h2>${editable(current.name || 'Name', preview, 'current.name')}</h2>
        <p>#${escapeHtml(current.badgeNumber || '----')}</p>
        <p>Awarded for ${escapeHtml(current.awardYear || '----')}</p>
        <p>${escapeHtml(current.rank || '')}</p>
        <p>Date of hire: ${escapeHtml(current.hireDate || '')}</p>
        <p>Years of service: ${escapeHtml(current.yearsOfService || '')}</p>
      </div>
      <div class="badge-slot">${item.branding.badgeMediaId ? `<img src="/media/${item.branding.badgeMediaId}" alt="">` : '<div class="seal-mark">STAR</div>'}</div>
    </div>
    <div class="history-head">Previous recipients</div>
    ${list('plates', item.award.history, item, (row) => `<article class="plate"><strong>${escapeHtml(row.name)}</strong><span>#${escapeHtml(row.badgeNumber || '')} · ${escapeHtml(row.awardYear || '')}</span></article>`)}
    <footer class="board-foot"><span>${escapeHtml(item.branding.agencyName || '')}</span><span>${escapeHtml(item.branding.sheriffLine || '')}</span></footer>
  </section>`
}
function directory(item) {
  return `<section class="directory"><h1 class="rise">${escapeHtml(item.directory.title || '')}</h1>
    ${list('cards', item.directory.cards, item, (card) => `<article class="card">${card.logoId ? `<img class="card-logo" src="/media/${card.logoId}" alt="">` : ''}<strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.subtitle || '')}</span><span>${escapeHtml(card.phone || '')}</span><span>${escapeHtml(card.details || '')}</span></article>`)}
  </section>`
}
function slides(item) {
  const slide = item.slides.slides[item._slideIndex || 0]
  if (!slide) return seal(item.branding)
  const image = slide.imageId ? ` style="background-image:linear-gradient(rgba(6,16,28,.55), rgba(6,16,28,.55)), url(/media/${slide.imageId})"` : ''
  return `<section class="slide rise"${image}><div class="slide-row"><div><h1>${escapeHtml(slide.title || '')}</h1><div class="body">${slide.bodyHtml || ''}</div></div>${slide.qrUrl ? `<figure class="qr-block"><img src="${qrDataUrl(slide.qrUrl)}" alt=""><figcaption>${escapeHtml(slide.qrLabel || '')}</figcaption></figure>` : ''}</div></section>`
}
function playlist(item) {
  const listItems = item.playlist.entries
  const override = item.playlist.override
  if (override) {
    if (override.payload) return bodyFor({ ...override.payload, presentation: { ...override.payload.presentation, progress: false } })
    return `<section class="slide"><h1>${escapeHtml(override.title || '')}</h1><div class="body"><p>${escapeHtml(override.body || '')}</p></div></section>`
  }
  const entry = listItems[item._playIndex || 0]
  if (!entry) return seal(item.branding)
  const child = { ...entry.payload, presentation: { ...entry.payload.presentation, progress: false, showClock: false, showWeather: false } }
  const progress = item.presentation.progress && !hold
  const left = formatLeft((item._progress ?? 1) * entry.durationSec)
  return `${bodyFor(child)}${progress ? `<div class="progress-line"><span style="transform:scaleX(${item._progress ?? 1})"></span></div><div class="progress-chip">${(item._playIndex || 0) + 1} of ${listItems.length} · ${left}</div>` : ''}`
}
function list(className, items, item, render) {
  const scroll = item.presentation.listOverflow === 'slow-scroll'
  return `<div class="history-window" data-scroll="${scroll ? '1' : '0'}" data-seconds="${item.presentation.scrollSecondsPerRow || 12}" data-count="${items.length}"><div class="${className}">${items.map(render).join('')}</div></div>`
}
function chrome() {
  if (!payload.presentation.showClock && !payload.weather) return ''
  return `<div class="footer-chrome">${payload.presentation.showClock ? `<span data-clock>${clockText()}</span>` : ''}${payload.weather ? `<span>${payload.weather.tempF}° ${escapeHtml(payload.weather.condition || payload.weather.summary || '')}</span>` : ''}</div>`
}
function paintChrome() {
  const node = root.querySelector('[data-clock]')
  if (node) node.textContent = clockText()
}
function clockText() {
  if (!payload?._clientNow) payload._clientNow = Date.now()
  const time = new Date(new Date(payload.serverNow).getTime() + (Date.now() - payload._clientNow))
  return new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone, hour: 'numeric', minute: '2-digit' }).format(time)
}
setInterval(paintChrome, 1000)
function seal(branding) {
  return `<div class="seal-only">${branding?.sealMediaId ? `<img src="/media/${branding.sealMediaId}" alt="" style="width:22%">` : '<div class="seal-mark">STAR</div>'}<div>${escapeHtml(branding?.agencyName || '')}</div></div>`
}
function editable(text, enabled, path) {
  if (!enabled) return escapeHtml(text || '')
  return `<span contenteditable="true" data-edit="${path}">${escapeHtml(text || '')}</span>`
}
function bindEdits() {
  root.querySelectorAll('[data-edit]').forEach((node) => {
    node.addEventListener('blur', () => {
      if (window.parent !== window) window.parent.postMessage({ type: 'signage-edit', path: node.dataset.edit, value: node.textContent || '' }, location.origin)
    })
  })
}
function fitLists() {
  root.querySelectorAll('.history-window').forEach((el) => {
    let low = 0.45
    let high = 1
    let best = 0.45
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2
      el.style.setProperty('--fit', String(mid))
      if (el.scrollHeight <= el.clientHeight + 2) { best = mid; low = mid } else high = mid
    }
    const scroll = el.dataset.scroll === '1' && best < 0.72
    el.style.setProperty('--fit', String(scroll ? 0.78 : best))
    if (!scroll) return
    el.classList.add('fade')
    const grid = el.firstElementChild
    grid.classList.add('scroll-track')
    grid.innerHTML += grid.innerHTML
    grid.style.animationDuration = `${Math.max(Number(el.dataset.count) || 1, 1) * Number(el.dataset.seconds || 12)}s`
  })
}
let slideTimer = 0
let playTimer = 0
let playFrame = 0
function startSlides() {
  clearTimeout(slideTimer)
  if (!payload || payload.template !== 'slides' || preview) return
  const slides = payload.slides?.slides || []
  if (slides.length < 2) return
  const index = payload._slideIndex || 0
  slideTimer = setTimeout(() => {
    payload._slideIndex = (index + 1) % slides.length
    paint()
  }, (slides[index]?.durationSec || 12) * 1000)
}
function startPlaylist() {
  clearTimeout(playTimer)
  cancelAnimationFrame(playFrame)
  if (!payload || payload.template !== 'playlist' || preview || payload.playlist?.override) return
  const entries = payload.playlist?.entries || []
  if (!entries.length) return
  const index = payload._playIndex || 0
  const duration = (entries[index]?.durationSec || 15) * 1000
  const started = performance.now()
  const tick = (now) => {
    if (hold) { playFrame = requestAnimationFrame(tick); return }
    payload._progress = 1 - Math.min(1, (now - started) / duration)
    const bar = root.querySelector('.progress-line span')
    const chip = root.querySelector('.progress-chip')
    if (bar) bar.style.transform = `scaleX(${payload._progress})`
    if (chip) chip.textContent = `${index + 1} of ${entries.length} · ${formatLeft(payload._progress * entries[index].durationSec)}`
    playFrame = requestAnimationFrame(tick)
  }
  playFrame = requestAnimationFrame(tick)
  playTimer = setTimeout(() => {
    payload._playIndex = (index + 1) % entries.length
    payload._progress = 1
    paint()
  }, duration)
}
function formatLeft(seconds) {
  const value = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
