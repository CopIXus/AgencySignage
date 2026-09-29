const base = process.env.BASE || 'http://127.0.0.1:8080'
const password = process.argv[2]
if (!password) {
  console.error('Usage: node scripts/smoke.mjs <admin-password>')
  process.exit(1)
}

async function api(url, init = {}) {
  const response = await fetch(base + url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${url} ${response.status} ${text}`)
  return { body, cookie: response.headers.getSetCookie?.() || [] }
}

const login = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password }) })
const cookie = login.cookie.map((item) => item.split(';')[0]).join('; ')
const auth = { headers: { cookie } }
const screen = (await api('/api/screens', { method: 'POST', ...auth, body: JSON.stringify({ name: 'Patrol Deputy', template: 'award', modeId: '1080x1920' }) })).body
const detail = (await api(`/api/screens/${screen.id}`, auth)).body
detail.draft.current = { name: 'Boucher, Ryan', badgeNumber: '1845', awardYear: '2026', rank: 'Deputy II', hireDate: '4/21/2014', yearsOfService: '12', photoId: null }
detail.draft.branding.sheriffLine = 'Michael J. Bouchard - Sheriff'
await api(`/api/screens/${screen.id}`, { method: 'PUT', ...auth, body: JSON.stringify({ name: detail.name, draft: detail.draft, presentation: detail.presentation, modeId: detail.mode.id, turn: detail.turn, datasetId: detail.datasetId }) })
const datasets = (await api('/api/datasets', auth)).body
const dataset = datasets.find((item) => item.id === detail.datasetId)
await api(`/api/datasets/${dataset.id}`, { method: 'PUT', ...auth, body: JSON.stringify({ rows: [{ id: 'h1', name: 'Earlier, Pat', badgeNumber: '100', awardYear: '2024' }] }) })
await api(`/api/datasets/${dataset.id}/import`, { method: 'POST', ...auth, body: JSON.stringify({ csv: 'name,subtitle,phone,details\nNope,x,1,y', replace: false }) }).catch(() => undefined)
await api(`/api/screens/${screen.id}/publish`, { method: 'POST', ...auth, body: '{}' })
const live = (await api(`/api/public/screens/${screen.slug}?load=1&playerId=smoke&deviceName=Smoke&width=1080&height=1920&dpr=1&version=0`)).body
if (live.award?.current?.name !== 'Boucher, Ryan') throw new Error('award payload missing honoree')
const again = (await api(`/api/public/screens/${screen.slug}?playerId=smoke&deviceName=Smoke&width=1080&height=1920&dpr=1&version=${live.version}`)).body
if (!again.unchanged) throw new Error('expected unchanged poll')
const dash = (await api('/api/dashboard', auth)).body
const row = dash.screens.find((item) => item.id === screen.id)
if (!row || row.loadCount < 1) throw new Error('load count missing')
if (!row.players.some((player) => player.device_name === 'Smoke')) throw new Error('player heartbeat missing')
console.log('smoke ok', screen.slug, 'version', live.version)
