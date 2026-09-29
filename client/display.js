import { qrDataUrl } from './qr.js'

const slug = location.pathname.split('/').filter(Boolean)[1] || ''
const preview = new URLSearchParams(location.search).get('preview') === '1'
const root = document.querySelector('#root')
let payload = null
let version = 0
let tone = false
let logo = false
let hold = false
const holds = new Set()
const detailItems = new Map()
let detailTimer = 0

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
  if (tone) {
    const burn = payload?.presentation?.burnIn
    setTimeout(flashLogo, ((burn?.toneFadeSeconds || 30) * 2 + (burn?.toneHoldSeconds || 45)) * 1000)
    return
  }
  setHold('logo', true)
  logo = true
  paint()
  setTimeout(() => {
    logo = false
    setHold('logo', false)
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
  clearInterval(detailTimer)
  holds.delete('detail')
  hold = holds.size > 0
  detailItems.clear()
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
  const layout = payload.layout && payload.layout.enabled ? payload.layout : null
  root.innerHTML = `<div class="stage-root ${preview ? 'previewing' : ''} ${payload.presentation.details ? 'interactive' : ''}">
    <div class="canvas-wrap" style="width:${payload.mode.width}px;height:${payload.mode.height}px;transform:translate(-50%, -50%) rotate(${turn}deg) scale(${scale})">
      <div class="canvas ${wide ? 'wide' : 'tall'} ${tight ? 'tight' : ''} ${layout ? 'layered' : ''} motion-${payload.presentation.motion} ${tone ? 'light' : ''} ${hold ? 'holding' : ''}" style="width:${payload.mode.width}px;height:${payload.mode.height}px;--primary:${branding.primary};--accent:${branding.accent};--ink:${branding.ink};--plate:${branding.plate};--light-bg:${branding.lightBg};--light-ink:${branding.lightInk};font-family:${fontStack(branding.font)}">
        ${layout ? layered(payload, layout, branding) : (payload.empty ? seal(branding) : bodyFor(payload))}
        ${chrome()}
      </div>
    </div>
    ${logo ? `<div class="logo-rest">${(payload.presentation.burnIn.logoMediaId || branding.sealMediaId) ? `<img src="/media/${payload.presentation.burnIn.logoMediaId || branding.sealMediaId}" alt="">` : '<div class="seal-mark">STAR</div>'}</div>` : ''}
  </div>`
  fitPanels()
  bindEdits()
  bindDetails()
  bindPanels()
  fitLists()
  startPlaylist()
  startSlides()
}

function fontStack(font) {
  if (font === 'serif') return 'Georgia, "Liberation Serif", serif'
  if (font === 'rounded') return '"Trebuchet MS", "Nunito", "Liberation Sans", sans-serif'
  if (font === 'mono') return '"Cascadia Mono", "JetBrains Mono", "Liberation Mono", monospace'
  return '"Segoe UI", "Liberation Sans", sans-serif'
}

/* Layout mode: background photo, dimmer, and floating panels placed in percent of the canvas. */
function layered(item, layout, branding) {
  const fit = layout.backgroundFit === 'contain' ? 'contain' : 'cover'
  const background = layout.backgroundMediaId
    ? `<div class="layer-bg" style="background-image:url(/media/${escapeHtml(layout.backgroundMediaId)});background-size:${fit};filter:blur(${Number(layout.blur) || 0}px)"></div>`
    : ''
  const dim = `<div class="layer-dim" style="background:rgba(0,0,0,${Math.min(100, Math.max(0, Number(layout.dim) || 0)) / 100})"></div>`
  return background + dim + (layout.sections || []).map((section) => panel(item, section, branding)).join('')
}
function panel(item, section, branding) {
  const size = (Number(section.font) || 100) / 100
  const style = [
    `left:${num(section.x, 0)}%`, `top:${num(section.y, 0)}%`, `width:${num(section.w, 40)}%`, `height:${num(section.h, 20)}%`,
    `background:${section.fill || 'transparent'}`, `border-radius:${num(section.radius, 0)}px`, `padding:${num(section.padding, 0)}%`,
    section.ink ? `color:${section.ink}` : '', `text-align:${section.align || 'left'}`,
    section.border ? `border:${num(section.borderWidth, 2)}px solid ${section.border}` : '',
    section.shadow ? 'box-shadow:0 18px 60px rgba(0,0,0,.35)' : '',
  ].filter(Boolean).join(';')
  let inner = ''
  if (section.kind === 'content') inner = `<div class="panel-inner panel-content">${item.empty ? seal(branding) : bodyFor(item)}</div>`
  else if (section.kind === 'text') inner = `<div class="panel-inner panel-text" style="font-size:${(2.6 * size).toFixed(2)}cqh">${section.title ? `<h3>${escapeHtml(section.title)}</h3>` : ''}${section.body ? `<div>${escapeHtml(section.body).replace(/\n/g, '<br>')}</div>` : ''}</div>`
  else if (section.kind === 'image') inner = section.mediaId ? `<img class="panel-image" src="/media/${escapeHtml(section.mediaId)}" style="object-fit:${section.fit === 'cover' ? 'cover' : 'contain'}" alt="">` : '<div class="panel-placeholder">Choose a photo or logo</div>'
  else if (section.kind === 'clock') inner = `<div class="panel-inner panel-clock" style="font-size:${(6 * size).toFixed(2)}cqh"><span data-clock>${clockText()}</span>${section.showDate ? `<small data-date>${dateText()}</small>` : ''}</div>`
  const label = { content: 'Content', text: 'Text', image: 'Image', clock: 'Clock' }[section.kind] || section.kind
  return `<div class="panel panel-${escapeHtml(section.kind)} scroll-${escapeHtml(section.scroll || 'auto')}" data-section="${escapeHtml(section.id)}" style="${style}">${inner}${preview ? `<div class="panel-handle">${label} · drag to move</div><div class="panel-resize"></div>` : ''}</div>`
}
function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function fitPanels() {
  if (preview) return
  root.querySelectorAll('.panel.scroll-auto').forEach((panelNode) => {
    const inner = panelNode.querySelector('.panel-inner')
    if (!inner || panelNode.scrollHeight <= panelNode.clientHeight + 2) return
    const seconds = Math.max(20, Math.round(inner.scrollHeight / 28))
    inner.innerHTML += `<div class="panel-gap"></div>${inner.innerHTML}`
    inner.classList.add('panel-drift')
    inner.style.animationDuration = `${seconds}s`
  })
}
let selectedSection = ''
function bindPanels() {
  if (!preview) return
  root.querySelectorAll('.panel').forEach((panelNode) => {
    const id = panelNode.dataset.section
    if (id === selectedSection) panelNode.classList.add('selected')
    panelNode.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      const resizing = Boolean(event.target.closest('.panel-resize'))
      if (!resizing && event.target.closest('[contenteditable], .detail-sheet')) return
      const canvas = root.querySelector('.canvas')
      const rect = panelNode.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const ratio = payload.mode.width / canvasRect.width
      const start = { x: event.clientX, y: event.clientY, left: rect.left - canvasRect.left, top: rect.top - canvasRect.top, width: rect.width, height: rect.height }
      let moved = false
      selectPanel(panelNode)
      const move = (ev) => {
        const dx = (ev.clientX - start.x) * ratio
        const dy = (ev.clientY - start.y) * ratio
        if (!moved && Math.hypot(dx, dy) < 4) return
        moved = true
        const box = resizing
          ? { x: start.left * ratio, y: start.top * ratio, w: Math.max(40, start.width * ratio + dx), h: Math.max(40, start.height * ratio + dy) }
          : { x: start.left * ratio + dx, y: start.top * ratio + dy, w: start.width * ratio, h: start.height * ratio }
        const pct = {
          x: clamp(box.x / payload.mode.width * 100, -20, 100), y: clamp(box.y / payload.mode.height * 100, -20, 100),
          w: clamp(box.w / payload.mode.width * 100, 2, 140), h: clamp(box.h / payload.mode.height * 100, 2, 140),
        }
        panelNode.style.left = `${pct.x}%`; panelNode.style.top = `${pct.y}%`; panelNode.style.width = `${pct.w}%`; panelNode.style.height = `${pct.h}%`
        panelNode.dataset.pending = JSON.stringify(pct)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (!moved) return
        const pct = JSON.parse(panelNode.dataset.pending || '{}')
        window.parent.postMessage({ type: 'signage-layout', id, ...roundBox(pct) }, location.origin)
        panelNode.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault() }, { capture: true, once: true })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })
  })
}
function selectPanel(panelNode) {
  root.querySelectorAll('.panel.selected').forEach((node) => node.classList.remove('selected'))
  panelNode.classList.add('selected')
  selectedSection = panelNode.dataset.section
  window.parent.postMessage({ type: 'signage-select', id: selectedSection }, location.origin)
}
function roundBox(box) {
  return Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value * 10) / 10]))
}
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)) }

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
    <div class="honoree rise"${remember('current', personRecord(current))}>
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
    ${list('plates', item.award.history, item, (row) => `<article class="plate ${row.photoId ? 'with-photo' : ''}"${remember(row.id, personRecord(row))}>${row.photoId ? `<img class="plate-photo" src="/media/${escapeHtml(row.photoId)}" alt="">` : ''}<strong>${escapeHtml(row.name)}</strong><span>#${escapeHtml(row.badgeNumber || '')} · ${escapeHtml(row.awardYear || '')}</span></article>`)}
    <footer class="board-foot"><span>${escapeHtml(item.branding.agencyName || '')}</span><span>${escapeHtml(item.branding.sheriffLine || '')}</span></footer>
  </section>`
}
function directory(item) {
  return `<section class="directory"><h1 class="rise">${escapeHtml(item.directory.title || '')}</h1>
    ${list('cards', item.directory.cards, item, (card) => `<article class="card ${card.logoId ? 'with-logo' : ''}"${remember(card.id, { title: card.name, image: card.logoId, lines: [card.subtitle, card.phone, card.address, card.hours].filter(Boolean), body: card.details || '' })}>${card.logoId ? `<img class="card-logo" src="/media/${escapeHtml(card.logoId)}" alt="">` : ''}<div class="card-text"><strong>${escapeHtml(card.name)}</strong>${card.subtitle ? `<span>${escapeHtml(card.subtitle)}</span>` : ''}${card.phone ? `<span>${escapeHtml(card.phone)}</span>` : ''}${card.address ? `<span>${escapeHtml(card.address)}</span>` : ''}${card.hours ? `<span>${escapeHtml(card.hours)}</span>` : ''}${card.details ? `<span>${escapeHtml(card.details)}</span>` : ''}</div></article>`)}
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
  const child = { ...entry.payload, presentation: { ...entry.payload.presentation, progress: false, showClock: false, showWeather: false, details: item.presentation.details, detailsSeconds: item.presentation.detailsSeconds } }
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
  root.querySelectorAll('[data-clock]').forEach((node) => { node.textContent = clockText() })
  root.querySelectorAll('[data-date]').forEach((node) => { node.textContent = dateText() })
}
function nowOnServer() {
  if (!payload?._clientNow) payload._clientNow = Date.now()
  return new Date(new Date(payload.serverNow).getTime() + (Date.now() - payload._clientNow))
}
function clockText() {
  return new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone, hour: 'numeric', minute: '2-digit' }).format(nowOnServer())
}
function dateText() {
  return new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(nowOnServer())
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
function remember(id, record) {
  if (!payload?.presentation?.details || !id) return ''
  detailItems.set(String(id), record)
  return ` data-detail-id="${escapeHtml(id)}"`
}
function personRecord(person) {
  return {
    title: person.name || 'Name',
    image: person.photoId,
    lines: [
      person.badgeNumber ? `#${person.badgeNumber}` : '',
      person.awardYear ? `Awarded for ${person.awardYear}` : '',
      person.rank || '',
      person.hireDate ? `Date of hire: ${person.hireDate}` : '',
      person.yearsOfService ? `Years of service: ${person.yearsOfService}` : '',
    ].filter(Boolean),
    body: '',
  }
}
function bindDetails() {
  root.querySelectorAll('[data-detail-id]').forEach((node) => {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[contenteditable]')) return
      const record = detailItems.get(node.dataset.detailId)
      if (!record) return
      event.preventDefault()
      openDetail(record)
    })
  })
}
function openDetail(record) {
  const canvas = root.querySelector('.canvas')
  if (!canvas) return
  canvas.querySelector('.detail-sheet')?.remove()
  const seconds = Math.max(5, Number(payload.presentation.detailsSeconds) || 30)
  canvas.insertAdjacentHTML('beforeend', `<div class="detail-sheet">
    <button class="detail-close" type="button">Close</button>
    <article class="detail-card">
      ${record.image ? `<img src="/media/${escapeHtml(record.image)}" alt="">` : ''}
      <h2>${escapeHtml(record.title || '')}</h2>
      ${(record.lines || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      ${record.body ? `<div class="detail-body">${escapeHtml(record.body)}</div>` : ''}
    </article>
    <div class="detail-timeout"><span></span></div>
  </div>`)
  const sheet = canvas.querySelector('.detail-sheet')
  sheet.addEventListener('click', (event) => { if (event.target === sheet) closeDetail() })
  sheet.querySelector('.detail-close').addEventListener('click', (event) => { event.stopPropagation(); closeDetail() })
  sheet.querySelector('.detail-card').addEventListener('pointerdown', () => armDetail(seconds))
  setHold('detail', true)
  armDetail(seconds)
}
function armDetail(seconds) {
  clearInterval(detailTimer)
  const ends = performance.now() + seconds * 1000
  const bar = root.querySelector('.detail-timeout span')
  const tick = () => {
    const left = ends - performance.now()
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / (seconds * 1000))})`
    if (left <= 0) closeDetail()
  }
  tick()
  detailTimer = setInterval(tick, 200)
}
function closeDetail() {
  clearInterval(detailTimer)
  root.querySelector('.detail-sheet')?.remove()
  setHold('detail', false)
}
function setHold(reason, on) {
  const was = holds.size > 0
  if (on) holds.add(reason)
  else holds.delete(reason)
  hold = holds.size > 0
  root.querySelector('.canvas')?.classList.toggle('holding', hold)
  if (!payload) return
  if (hold && !was) {
    payload._heldAt = performance.now()
    payload._playLeft = Math.max(0, (payload._playUntil || performance.now()) - performance.now())
    clearTimeout(playTimer)
  }
  if (!hold && was) {
    if (payload._heldAt && payload._playStarted) payload._playStarted += performance.now() - payload._heldAt
    payload._heldAt = 0
    if (playAdvance && payload._playLeft != null) armPlay(payload._playLeft)
  }
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
let playAdvance = null
function armPlay(ms) {
  clearTimeout(playTimer)
  payload._playLeft = ms
  payload._playUntil = performance.now() + ms
  if (hold || !playAdvance) return
  playTimer = setTimeout(() => playAdvance(), ms)
}
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
  playAdvance = null
  if (!payload || payload.template !== 'playlist' || preview || payload.playlist?.override) return
  const entries = payload.playlist?.entries || []
  if (!entries.length) return
  const index = payload._playIndex || 0
  const duration = (entries[index]?.durationSec || 15) * 1000
  payload._playStarted = performance.now()
  const tick = (now) => {
    if (hold) { playFrame = requestAnimationFrame(tick); return }
    payload._progress = 1 - Math.min(1, (now - payload._playStarted) / duration)
    const bar = root.querySelector('.progress-line span')
    const chip = root.querySelector('.progress-chip')
    if (bar) bar.style.transform = `scaleX(${payload._progress})`
    if (chip) chip.textContent = `${index + 1} of ${entries.length} · ${formatLeft(payload._progress * entries[index].durationSec)}`
    playFrame = requestAnimationFrame(tick)
  }
  playAdvance = () => {
    payload._playIndex = (index + 1) % entries.length
    payload._progress = 1
    paint()
  }
  playFrame = requestAnimationFrame(tick)
  armPlay(duration)
}
function formatLeft(seconds) {
  const value = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
