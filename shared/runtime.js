import crypto from 'node:crypto'

export const DISPLAY_MODES = buildModes()

function buildModes() {
  const pairs = [
    [1280, 720, 'HD'], [1366, 768, 'WXGA'], [1600, 900, 'HD+'], [1920, 1080, 'Full HD'],
    [2560, 1440, 'QHD'], [3840, 2160, '4K UHD'], [4096, 2160, 'DCI 4K'],
    [1280, 800, 'WXGA'], [1440, 900, 'WXGA+'], [1680, 1050, 'WSXGA+'], [1920, 1200, 'WUXGA'], [2560, 1600, 'WQXGA'],
    [1024, 768, 'XGA'], [1600, 1200, 'UXGA'], [1920, 1440, '4:3'],
    [720, 1280, 'HD portrait'], [768, 1366, 'WXGA portrait'], [900, 1600, 'HD+ portrait'], [1080, 1920, 'Full HD portrait'],
    [1440, 2560, 'QHD portrait'], [2160, 3840, '4K portrait'], [2160, 4096, 'DCI 4K portrait'],
    [800, 1280, 'WXGA portrait'], [900, 1440, 'WXGA+ portrait'], [1050, 1680, 'WSXGA+ portrait'], [1200, 1920, 'WUXGA portrait'], [1600, 2560, 'WQXGA portrait'],
    [768, 1024, 'XGA portrait'], [1200, 1600, 'UXGA portrait'], [1440, 1920, '3:4'],
  ]
  return pairs.map(([width, height, label]) => ({ id: `${width}x${height}`, label: `${label} ${width}×${height}`, width, height, family: familyFor(width, height) }))
}

export function familyFor(width, height) {
  const landscape = width >= height
  const abs = landscape ? width / height : height / width
  const base = abs >= 1.7 ? '16:9' : abs >= 1.45 ? '16:10' : '4:3'
  if (landscape) return base
  if (base === '16:9') return '9:16'
  if (base === '16:10') return '10:16'
  return '3:4'
}

export function isWideFamily(family) {
  return family === '16:9' || family === '16:10' || family === '4:3'
}

export function resolveMode(input = {}) {
  if (input.id && input.id !== 'custom') {
    const found = DISPLAY_MODES.find((item) => item.id === input.id)
    if (found) return found
  }
  if (input.width && input.height) return customMode(input.width, input.height)
  return DISPLAY_MODES.find((item) => item.id === '1920x1080')
}

export function customMode(width, height) {
  const w = clamp(width)
  const h = clamp(height)
  return { id: `custom-${w}x${h}`, label: `Custom ${w}×${h}`, width: w, height: h, family: familyFor(w, h) }
}

function clamp(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 1920
  return Math.max(640, Math.min(4096, n))
}

export function closestMode(width, height) {
  return DISPLAY_MODES.reduce((best, item) => {
    const score = Math.abs(item.width - width) + Math.abs(item.height - height)
    return score < best.score ? { item, score } : best
  }, { item: DISPLAY_MODES[0], score: Infinity }).item
}

export function brandingDefaults() {
  return {
    agencyName: 'Agency',
    sheriffLine: 'Sheriff',
    primary: '#0c2340',
    accent: '#c4a35a',
    ink: '#f4efe4',
    plate: '#f3e6c4',
    lightBg: '#f6f1e6',
    lightInk: '#0c2340',
    badgeMediaId: null,
    sealMediaId: null,
  }
}

export function presentationDefaults(template) {
  return {
    motion: 'subtle',
    listOverflow: template === 'award' ? 'slow-scroll' : 'fit',
    scrollSecondsPerRow: 12,
    burnIn: { logo: false, logoEveryMinutes: 30, logoSeconds: 8, logoMediaId: null, tone: false, toneEveryMinutes: 60, toneFadeSeconds: 30, toneHoldSeconds: 45 },
    showClock: false,
    showWeather: false,
    progress: template === 'playlist',
    details: false,
    detailsSeconds: 30,
  }
}

/**
 * Layout = optional background photo + floating sections drawn over it.
 * Positions are percentages of the screen so the same layout works on any mode.
 * The `content` section is where the template (award, directory, slides) renders;
 * it scrolls when the data is taller than the box.
 */
export function defaultLayout() {
  return {
    enabled: false,
    backgroundMediaId: null,
    backgroundFit: 'cover',
    dim: 35,
    blur: 0,
    sections: [
      { id: 'content', kind: 'content', x: 5, y: 8, w: 90, h: 84, fill: 'rgba(12,35,64,0.72)', ink: '', radius: 18, padding: 3, align: 'left', scroll: 'auto', font: 100 },
    ],
  }
}

export function newSection(kind) {
  const base = { id: `s${Math.random().toString(36).slice(2, 8)}`, kind, x: 10, y: 10, w: 40, h: 20, fill: 'rgba(12,35,64,0.72)', ink: '', radius: 18, padding: 3, align: 'left', scroll: 'auto', font: 100 }
  if (kind === 'text') return { ...base, title: 'Heading', body: 'Text shown inside this floating panel.' }
  if (kind === 'image') return { ...base, mediaId: null, fit: 'contain', fill: 'transparent' }
  if (kind === 'clock') return { ...base, w: 30, h: 12, showDate: true }
  if (kind === 'content') return { ...base, x: 5, y: 8, w: 90, h: 84 }
  return base
}

export const SECTION_KINDS = [
  { id: 'content', label: 'Template content', help: 'The award board, directory cards, or slides. Scrolls when the data is taller than the box.' },
  { id: 'text', label: 'Text panel', help: 'A heading and paragraph you write yourself.' },
  { id: 'image', label: 'Photo or logo', help: 'One uploaded image, fitted inside the box.' },
  { id: 'clock', label: 'Clock', help: 'Large time with optional date.' },
]

export function emptyDraft(template) {
  const branding = brandingDefaults()
  const layout = defaultLayout()
  if (template === 'award') {
    return { title: 'Patrol Deputy of the Year', branding, layout, current: { name: '', badgeNumber: '', awardYear: '', rank: '', hireDate: '', yearsOfService: '', photoId: null } }
  }
  if (template === 'directory') return { title: 'Bonding Companies', branding, layout }
  if (template === 'slides') return { branding, layout }
  return { branding, layout, entries: [] }
}

export function datasetKindFor(template) {
  if (template === 'award') return 'honorees'
  if (template === 'directory') return 'cards'
  if (template === 'slides') return 'slides'
  return null
}

export function isActiveNow(item, now, timeZone) {
  const parts = zonedParts(now, timeZone)
  if (item.days?.length && !item.days.includes(parts.weekday)) return false
  const start = parseMinutes(item.startTime)
  const end = parseMinutes(item.endTime)
  if (start === null && end === null) return true
  const minutes = parts.hour * 60 + parts.minute
  if (start !== null && end !== null && start > end) return minutes >= start || minutes < end
  if (start !== null && minutes < start) return false
  if (end !== null && minutes >= end) return false
  return true
}

function parseMinutes(value) {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function zonedParts(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', hourCycle: 'h23' })
  const map = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { weekday: Math.max(0, weekdays.indexOf(map.weekday)), hour: Number(map.hour), minute: Number(map.minute), year: Number(map.year) }
}

export function clockLooksWrong(now) {
  const year = now.getFullYear()
  return year < 2024 || year > 2100
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(cell.trim()); cell = ''; continue }
    if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; continue }
    if (char !== '\r') cell += char
  }
  if (cell.length || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows.filter((item) => item.some((value) => value.length > 0))
}

export function cardsFromCsv(text, existing, replace) {
  const table = parseCsv(text)
  if (!table.length) return replace ? [] : existing
  const header = table[0].map((value) => value.toLowerCase())
  const hasHeader = header.some((value) => ['name', 'subtitle', 'phone', 'details'].includes(value))
  const body = hasHeader ? table.slice(1) : table
  const index = (key, fallback) => { const found = header.indexOf(key); return hasHeader && found >= 0 ? found : fallback }
  const next = replace ? [] : existing.map((item) => ({ ...item }))
  for (const cells of body) {
    const name = cells[index('name', 0)] || ''
    if (!name) continue
    const found = next.find((item) => item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
    if (found) {
      found.subtitle = cells[index('subtitle', 1)] || ''
      found.phone = cells[index('phone', 2)] || ''
      found.details = cells[index('details', 3)] || ''
    } else {
      next.push({ id: crypto.randomUUID(), name, subtitle: cells[index('subtitle', 1)] || '', phone: cells[index('phone', 2)] || '', details: cells[index('details', 3)] || '', logoId: null })
    }
  }
  next.sort((a, b) => a.name.localeCompare(b.name))
  return next
}
