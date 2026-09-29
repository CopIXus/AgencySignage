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
const created = []
try {
  const screen = (await api('/api/screens', { method: 'POST', ...auth, body: JSON.stringify({ name: 'Smoke award', template: 'award', modeId: 'fhd-portrait' }) })).body
  created.push(screen.id)
  const detail = (await api(`/api/screens/${screen.id}`, auth)).body
  if (!detail.draft.layout || detail.draft.layout.enabled) throw new Error('layout defaults missing')
  detail.draft.current = { name: 'Sample, Deputy', badgeNumber: '1000', awardYear: '2026', rank: 'Deputy', hireDate: '1/1/2015', yearsOfService: '11', photoId: null }
  detail.draft.branding.sheriffLine = 'Sample Sheriff'
  detail.draft.layout.enabled = true
  detail.draft.layout.sections.push({ id: 'note', kind: 'text', x: 60, y: 5, w: 35, h: 20, title: 'Notice', body: 'Smoke test', fill: 'rgba(0,0,0,0.5)' })
  await api(`/api/screens/${screen.id}`, { method: 'PUT', ...auth, body: JSON.stringify({ name: detail.name, draft: detail.draft, presentation: detail.presentation, modeId: detail.mode.id, turn: detail.turn }) })
  const datasets = (await api('/api/datasets', auth)).body
  const dataset = datasets.find((item) => item.id === detail.datasetId)
  await api(`/api/datasets/${dataset.id}`, { method: 'PUT', ...auth, body: JSON.stringify({ rows: [{ id: 'h1', name: 'Earlier, Pat', badgeNumber: '100', awardYear: '2024' }] }) })
  await api(`/api/datasets/${dataset.id}/import`, { method: 'POST', ...auth, body: JSON.stringify({ csv: 'name,subtitle,phone,details\nNope,x,1,y', replace: false }) }).catch(() => undefined)
  await api(`/api/screens/${screen.id}/publish`, { method: 'POST', ...auth, body: '{}' })
  const live = (await api(`/api/public/screens/${screen.slug}?load=1&playerId=smoke&deviceName=Smoke&width=1080&height=1920&dpr=1&version=0`)).body
  if (live.award?.current?.name !== 'Sample, Deputy') throw new Error('award payload missing honoree')
  if (!live.layout?.enabled || live.layout.sections.length !== 2) throw new Error('layout missing from payload')
  const again = (await api(`/api/public/screens/${screen.slug}?playerId=smoke&deviceName=Smoke&width=1080&height=1920&dpr=1&version=${live.version}`)).body
  if (!again.unchanged) throw new Error('expected unchanged poll')
  const dash = (await api('/api/dashboard', auth)).body
  const row = dash.screens.find((item) => item.id === screen.id)
  if (!row || row.loadCount < 1) throw new Error('load count missing')
  if (!row.players.some((player) => player.device_name === 'Smoke')) throw new Error('player heartbeat missing')

  const token = (await api('/api/tokens', { method: 'POST', ...auth, body: JSON.stringify({ name: 'smoke', role: 'editor' }) })).body
  const viaToken = (await api('/api/me', { headers: { authorization: `Bearer ${token.token}` } })).body
  if (viaToken.role !== 'editor' || !viaToken.token) throw new Error('token auth failed')
  const denied = await fetch(`${base}/api/screens`, { headers: { authorization: 'Bearer wrong' } })
  if (denied.status !== 401) throw new Error('bad token was accepted')
  await api(`/api/tokens/${token.id}`, { method: 'DELETE', ...auth })
  const docs = await fetch(`${base}/api/docs`)
  if (!docs.ok || !(await docs.text()).includes('# Agency Signage')) throw new Error('docs missing')
  const schema = (await api('/api/schema')).body
  if (!schema.routes?.length || !schema.layout) throw new Error('schema missing')
  console.log('smoke ok', screen.slug, 'version', live.version)
} finally {
  for (const id of created) await api(`/api/screens/${id}`, { method: 'DELETE', ...auth }).catch(() => undefined)
}
