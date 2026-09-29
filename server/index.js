import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  agencyRow, backupDir, certDir, clientDir, dataDir, database, databasePath, getDataset, getScreen, getScreenBySlug,
  getUserByUsername, listDatasets, listScreens, listUsers, mediaDir, openDatabase,
} from './db.js'
import { buildPayload } from './payload.js'
import { createZip, readZip } from './zip.js'
import { hashPassword, verifyPassword } from './passwords.js'
import {
  DISPLAY_MODES, brandingDefaults, cardsFromCsv, clockLooksWrong, closestMode, customMode, datasetKindFor,
  emptyDraft, familyFor, presentationDefaults, resolveMode, zonedParts,
} from '../shared/runtime.js'

const httpPort = Number(process.env.SIGNAGE_HTTP_PORT || 8080)
const httpsPort = Number(process.env.SIGNAGE_HTTPS_PORT || 8443)
const insecure = process.env.SIGNAGE_INSECURE === '1'
openDatabase()
const db = new Proxy({}, {
  get(_target, prop) {
    const value = database()[prop]
    return typeof value === 'function' ? value.bind(database()) : value
  },
})
ensureFirstAdmin()
ensureCertificates()
maybeDailyBackup()

const routes = []
const route = (method, pattern, handler) => routes.push({ method, pattern, handler })

route('POST', '/api/login', async (req, res) => {
  const body = await readJson(req)
  const user = getUserByUsername(String(body.username || ''))
  if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) return send(res, 401, { error: 'Invalid username or password' })
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, user.id, new Date(Date.now() + 12 * 3600e3).toISOString())
  res.setHeader('Set-Cookie', cookie(id, req))
  send(res, 200, { id: user.id, username: user.username, role: user.role })
})
route('POST', '/api/logout', async (req, res) => {
  const sid = readCookie(req, 'signage_sid')
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
  res.setHeader('Set-Cookie', 'signage_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax')
  send(res, 200, { ok: true })
})
route('GET', '/api/me', async (req, res) => send(res, 200, currentUser(req)))
route('POST', '/api/me/password', async (req, res, user) => {
  const body = await readJson(req)
  if (String(body.password || '').length < 8) return send(res, 400, { error: 'Use at least 8 characters' })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), user.id)
  send(res, 200, { ok: true })
})
route('GET', '/api/dashboard', async (req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY device_name').all().map((row) => ({
    id: row.id, deviceName: row.device_name, device_name: row.device_name, screenSlug: row.screen_slug, lastSeen: row.last_seen,
    reportedVersion: row.reported_version, width: row.width, height: row.height, dpr: row.dpr,
    inUse: Date.now() - Date.parse(row.last_seen) < 30000,
  }))
  const screens = listScreens().map((row) => {
    const screen = publicScreen(row)
    screen.players = players.filter((player) => player.screenSlug === screen.slug)
    return screen
  })
  const publishes = db.prepare('SELECT * FROM publishes ORDER BY published_at DESC LIMIT 12').all()
  send(res, 200, { screens, players, publishes, diskFreeBytes: diskFree(), clockWarning: clockLooksWrong(new Date()), serverNow: new Date().toISOString(), timezone: agencyRow().timezone })
})
route('GET', '/api/screens', async (req, res) => send(res, 200, listScreens().map(publicScreen)))
route('POST', '/api/screens', async (req, res) => {
  const body = await readJson(req)
  const template = ['award', 'directory', 'slides', 'playlist'].includes(body.template) ? body.template : 'award'
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const mode = resolveMode(body.mode || (body.modeId ? { id: body.modeId } : {}))
  const kind = datasetKindFor(template)
  let datasetId = null
  if (kind) {
    datasetId = crypto.randomUUID()
    db.prepare('INSERT INTO datasets (id, name, kind, rows_json, source, source_url, interval_sec) VALUES (?, ?, ?, ?, ?, ?, ?)').run(datasetId, `${body.name || 'Screen'} data`, kind, '[]', 'manual', '', 300)
  }
  db.prepare('INSERT INTO screens (id, slug, name, template, mode_json, turn, presentation_json, dataset_id, draft_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)').run(
    id, uniqueSlug(body.name || template), String(body.name || 'Untitled'), template, JSON.stringify(mode), body.turn || 'counterclockwise',
    JSON.stringify(presentationDefaults(template)), datasetId, JSON.stringify(emptyDraft(template)), now, now,
  )
  send(res, 200, publicScreen(getScreen(id)))
})
route('GET', '/api/screens/:id', async (req, res, user, params) => {
  const row = getScreen(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  send(res, 200, publicScreen(row, true))
})
route('PUT', '/api/screens/:id', async (req, res, user, params) => {
  const row = getScreen(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  const body = await readJson(req)
  const current = publicScreen(row, true)
  const name = String(body.name || current.name)
  db.prepare('UPDATE screens SET name = ?, slug = ?, mode_json = ?, turn = ?, presentation_json = ?, draft_json = ?, updated_at = ? WHERE id = ?').run(
    name, body.slug ? slugify(body.slug) : current.slug, JSON.stringify(resolveMode(body.mode || (body.modeId ? { id: body.modeId } : current.mode))),
    body.turn || current.turn, JSON.stringify({ ...current.presentation, ...(body.presentation || {}) }),
    JSON.stringify(body.draft || current.draft), new Date().toISOString(), row.id,
  )
  send(res, 200, publicScreen(getScreen(row.id), true))
})
route('DELETE', '/api/screens/:id', async (req, res, user, params) => {
  db.prepare('DELETE FROM screens WHERE id = ?').run(params.id)
  send(res, 200, { ok: true })
})
route('POST', '/api/screens/:id/publish', async (req, res, user, params) => {
  const row = getScreen(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  const version = row.version + 1
  db.prepare('UPDATE screens SET published_json = draft_json, version = ?, updated_at = ? WHERE id = ?').run(version, new Date().toISOString(), row.id)
  db.prepare('INSERT INTO publishes (id, screen_id, user_id, username, version, published_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), row.id, user.id, user.username, version, new Date().toISOString())
  send(res, 200, publicScreen(getScreen(row.id), true))
})
route('POST', '/api/screens/:id/revert', async (req, res, user, params) => {
  const row = getScreen(params.id)
  if (!row?.published_json) return send(res, 400, { error: 'Nothing published yet' })
  db.prepare('UPDATE screens SET draft_json = published_json, updated_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  send(res, 200, publicScreen(getScreen(row.id), true))
})
route('POST', '/api/screens/:id/move-to-history', async (req, res, user, params) => {
  const row = getScreen(params.id)
  const dataset = row?.dataset_id ? getDataset(row.dataset_id) : null
  if (!row || row.template !== 'award' || !dataset) return send(res, 400, { error: 'Award screen required' })
  const draft = JSON.parse(row.draft_json)
  const current = draft.current || {}
  if (!current.name) return send(res, 400, { error: 'Current honoree needs a name' })
  const rows = JSON.parse(dataset.rows_json)
  rows.push({ id: crypto.randomUUID(), name: current.name, badgeNumber: current.badgeNumber || '', awardYear: current.awardYear || '', rank: current.rank || '', hireDate: current.hireDate || '', yearsOfService: current.yearsOfService || '', photoId: current.photoId || null })
  draft.current = { name: '', badgeNumber: '', awardYear: '', rank: '', hireDate: '', yearsOfService: '', photoId: null }
  db.prepare('UPDATE datasets SET rows_json = ? WHERE id = ?').run(JSON.stringify(rows), dataset.id)
  db.prepare('UPDATE screens SET draft_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(draft), new Date().toISOString(), row.id)
  send(res, 200, publicScreen(getScreen(row.id), true))
})
route('GET', '/api/datasets', async (req, res) => send(res, 200, listDatasets().map(publicDataset)))
route('POST', '/api/datasets', async (req, res) => {
  const body = await readJson(req)
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO datasets (id, name, kind, rows_json, source, source_url, interval_sec) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, body.name || 'Dataset', body.kind || 'cards', '[]', body.source || 'manual', '', Number(body.intervalSec || 300))
  send(res, 200, publicDataset(getDataset(id)))
})
route('PUT', '/api/datasets/:id', async (req, res, user, params) => {
  const row = getDataset(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  const body = await readJson(req)
  const source = body.source || row.source
  const sourceUrl = body.sourceUrl ?? row.source_url
  if (source === 'lan-http' && !isPrivateUrl(sourceUrl)) return send(res, 400, { error: 'Data source must be a private LAN address' })
  db.prepare('UPDATE datasets SET name = ?, rows_json = ?, source = ?, source_url = ?, interval_sec = ? WHERE id = ?').run(body.name || row.name, JSON.stringify(body.rows ?? JSON.parse(row.rows_json)), source, sourceUrl, Number(body.intervalSec || row.interval_sec), row.id)
  send(res, 200, publicDataset(getDataset(row.id)))
})
route('POST', '/api/datasets/:id/import', async (req, res, user, params) => {
  const row = getDataset(params.id)
  if (!row || row.kind !== 'cards') return send(res, 400, { error: 'CSV import is for card datasets' })
  const body = await readJson(req)
  const rows = cardsFromCsv(String(body.csv || ''), JSON.parse(row.rows_json), Boolean(body.replace))
  db.prepare('UPDATE datasets SET rows_json = ? WHERE id = ?').run(JSON.stringify(rows), row.id)
  send(res, 200, publicDataset(getDataset(row.id)))
})
route('POST', '/api/datasets/:id/fetch', async (req, res, user, params) => {
  const row = getDataset(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  await pullDataset(row)
  send(res, 200, publicDataset(getDataset(row.id)))
})
route('GET', '/api/media', async (req, res) => send(res, 200, db.prepare('SELECT * FROM media ORDER BY created_at DESC').all()))
route('POST', '/api/media', async (req, res) => {
  if (diskFree() < 500 * 1024 * 1024) return send(res, 507, { error: 'Not enough free disk space' })
  const form = await readForm(req)
  const file = form.files.file
  if (!file || file.data.length > 15 * 1024 * 1024) return send(res, 400, { error: 'Choose an image under 15 MB' })
  const cleaned = stripMetadata(file.data, file.mime)
  const id = crypto.randomUUID()
  const ext = cleaned.mime === 'image/png' ? 'png' : 'jpg'
  fs.writeFileSync(path.join(mediaDir, `${id}.${ext}`), cleaned.data)
  db.prepare('INSERT INTO media (id, folder, filename, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, form.fields.folder || 'photos', file.name || `${id}.${ext}`, cleaned.mime, cleaned.data.length, new Date().toISOString())
  send(res, 200, db.prepare('SELECT * FROM media WHERE id = ?').get(id))
})
route('DELETE', '/api/media/:id', async (req, res, user, params) => {
  for (const ext of ['jpg', 'png', 'webp']) fs.rmSync(path.join(mediaDir, `${params.id}.${ext}`), { force: true })
  db.prepare('DELETE FROM media WHERE id = ?').run(params.id)
  send(res, 200, { ok: true })
})
route('GET', '/media/:id', async (req, res, user, params) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(params.id)
  if (!row) return send(res, 404, { error: 'Not found' })
  const ext = row.mime === 'image/png' ? 'png' : 'jpg'
  const file = path.join(mediaDir, `${params.id}.${ext}`)
  if (!fs.existsSync(file)) return send(res, 404, { error: 'Not found' })
  res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=3600' })
  res.end(fs.readFileSync(file))
})
route('GET', '/api/agency', async (req, res) => send(res, 200, publicAgency()))
route('PUT', '/api/agency', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  const body = await readJson(req)
  db.prepare('UPDATE agency SET timezone = ?, weather_lat = ?, weather_lon = ? WHERE id = 1').run(body.timezone || 'America/Detroit', body.weatherLat ?? null, body.weatherLon ?? null)
  send(res, 200, publicAgency())
})
route('GET', '/api/users', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  send(res, 200, listUsers().map((row) => ({ id: row.id, username: row.username, role: row.role })))
})
route('POST', '/api/users', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  const body = await readJson(req)
  if (String(body.password || '').length < 8) return send(res, 400, { error: 'Use at least 8 characters' })
  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), String(body.username), hashPassword(String(body.password)), body.role === 'admin' ? 'admin' : 'editor')
  send(res, 200, listUsers().map((row) => ({ id: row.id, username: row.username, role: row.role })))
})
route('DELETE', '/api/users/:id', async (req, res, user, params) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  if (params.id === user.id) return send(res, 400, { error: 'You cannot remove yourself' })
  db.prepare('DELETE FROM users WHERE id = ?').run(params.id)
  send(res, 200, { ok: true })
})
route('GET', '/api/override', async (req, res) => send(res, 200, publicOverride()))
route('PUT', '/api/override', async (req, res) => {
  const body = await readJson(req)
  db.prepare('UPDATE overrides SET active = ?, title = ?, body = ?, screen_id = ? WHERE id = 1').run(body.active ? 1 : 0, body.title || '', body.body || '', body.screenId || null)
  send(res, 200, publicOverride())
})
route('GET', '/api/modes', async (req, res) => send(res, 200, DISPLAY_MODES))
route('GET', '/api/public/screens/:slug', async (req, res, user, params) => {
  const row = getScreenBySlug(params.slug)
  if (!row) return send(res, 404, { error: 'Not found' })
  const url = new URL(req.url, 'http://local')
  const preview = url.searchParams.get('preview') === '1'
  const version = Number(url.searchParams.get('version') || 0)
  if (!preview) {
    const id = url.searchParams.get('playerId') || crypto.randomUUID()
    db.prepare(`INSERT INTO players (id, device_name, screen_slug, last_seen, reported_version, width, height, dpr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET device_name = excluded.device_name, screen_slug = excluded.screen_slug, last_seen = excluded.last_seen, reported_version = excluded.reported_version, width = excluded.width, height = excluded.height, dpr = excluded.dpr`).run(
      id, url.searchParams.get('deviceName') || 'Display', params.slug, new Date().toISOString(), version || null, Number(url.searchParams.get('width') || 0), Number(url.searchParams.get('height') || 0), Number(url.searchParams.get('dpr') || 1),
    )
    if (url.searchParams.get('load') === '1') db.prepare('UPDATE screens SET load_count = load_count + 1 WHERE id = ?').run(row.id)
  }
  const fresh = getScreenBySlug(params.slug)
  if (!preview && version && version === fresh.version) {
    return send(res, 200, { unchanged: true, serverNow: new Date().toISOString(), weather: freshWeather() })
  }
  send(res, 200, payloadFor(fresh, preview ? 'draft' : 'published'))
})
route('GET', '/api/admin/backup', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  const file = backupDatabase()
  const files = [{ name: 'signage.db', data: fs.readFileSync(file) }]
  for (const name of fs.readdirSync(mediaDir)) files.push({ name: `media/${name}`, data: fs.readFileSync(path.join(mediaDir, name)) })
  const zip = createZip(files)
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="signage-backup.zip"' })
  res.end(zip)
})
route('POST', '/api/admin/restore', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  const form = await readForm(req)
  const file = form.files.file
  if (!file) return send(res, 400, { error: 'Choose a backup file' })
  const entries = readZip(file.data)
  const databaseFile = entries.find((item) => item.name === 'signage.db' || item.name.endsWith('/signage.db'))
  if (!databaseFile) return send(res, 400, { error: 'Backup is missing signage.db' })
  db.close()
  fs.writeFileSync(databasePath, databaseFile.data)
  for (const entry of entries) {
    if (!entry.name.startsWith('media/')) continue
    const safe = path.basename(entry.name)
    fs.writeFileSync(path.join(mediaDir, safe), entry.data)
  }
  openDatabase()
  send(res, 200, { ok: true })
})
route('POST', '/api/admin/enroll', async (req, res, user) => {
  if (user.role !== 'admin') return send(res, 403, { error: 'Admin only' })
  const body = await readJson(req)
  const token = crypto.randomBytes(18).toString('hex')
  db.prepare('INSERT INTO enroll_tokens (token, screen_id, device_name, restart_time, turn, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(token, body.screenId || null, body.deviceName || 'Lobby', body.restartTime || '03:00', body.turn || 'none', new Date(Date.now() + 30 * 60e3).toISOString())
  send(res, 200, { token })
})
route('GET', '/setup/install.sh', async (req, res) => sendInstaller(req, res, 'sh'))
route('GET', '/setup/install.ps1', async (req, res) => sendInstaller(req, res, 'ps1'))
route('GET', '/setup/ca.crt', async (req, res) => {
  const file = path.join(certDir, 'ca.crt')
  if (!fs.existsSync(file)) return send(res, 404, { error: 'No local certificate yet' })
  res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="agency-signage-ca.crt"' })
  res.end(fs.readFileSync(file))
})
route('POST', '/api/admin/kiosk/install', async (req, res) => {
  if (!isLoopback(req)) return send(res, 403, { error: 'Install from the display device itself' })
  const body = await readJson(req)
  const token = consumeToken(body.token)
  if (!token) return send(res, 400, { error: 'Setup link expired' })
  const screen = token.screen_id ? getScreen(token.screen_id) : null
  const script = kioskScript('sh', token, screen, req)
  const file = path.join(os.tmpdir(), 'agency-signage-kiosk.sh')
  fs.writeFileSync(file, script)
  const result = spawnSync('bash', [file], { encoding: 'utf8' })
  send(res, result.status === 0 ? 200 : 500, { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}` })
})
route('GET', '/api/setup/suggest', async (req, res) => {
  const url = new URL(req.url, 'http://local')
  send(res, 200, closestMode(Number(url.searchParams.get('width') || 1920), Number(url.searchParams.get('height') || 1080)))
})

const server = http.createServer((req, res) => {
  if (!insecure) {
    const host = (req.headers.host || 'signage.local').split(':')[0]
    res.writeHead(302, { Location: `https://${host}:${httpsPort}${req.url}` })
    res.end()
    return
  }
  handle(req, res)
})
server.listen(httpPort, '0.0.0.0', () => {
  console.log(`Agency signage ${insecure ? 'HTTP' : 'redirect'} http://0.0.0.0:${httpPort}`)
})
if (!insecure && fs.existsSync(path.join(certDir, 'server.crt'))) {
  https.createServer({ key: fs.readFileSync(path.join(certDir, 'server.key')), cert: fs.readFileSync(path.join(certDir, 'server.crt')) }, handle).listen(httpsPort, '0.0.0.0', () => {
    console.log(`Agency signage HTTPS https://0.0.0.0:${httpsPort}`)
  })
}
setInterval(() => refreshWeather().catch(() => {}), 20 * 60 * 1000)
setInterval(() => pullLanDatasets().catch(() => {}), 60 * 1000)
setInterval(maybeDailyBackup, 60 * 60 * 1000)
refreshWeather().catch(() => {})

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://local')
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') { res.writeHead(302, { Location: '/admin' }); res.end(); return }
    for (const item of routes) {
      if (item.method !== req.method) continue
      const params = matchPath(item.pattern, pathname)
      if (!params) continue
      const user = currentUser(req)
      if (pathname.startsWith('/api/') && !pathname.startsWith('/api/login') && !pathname.startsWith('/api/public/') && !pathname.startsWith('/api/setup/')) {
        if (!user) return send(res, 401, { error: 'Sign in required' })
      }
      await item.handler(req, res, user, params)
      return
    }
    if (pathname.startsWith('/screen/')) return file(res, path.join(clientDir, 'display.html'), 'text/html')
    if (pathname === '/setup' || pathname.startsWith('/setup/')) return file(res, path.join(clientDir, 'setup.html'), 'text/html')
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return file(res, path.join(clientDir, 'admin.html'), 'text/html')
    const asset = path.normalize(path.join(clientDir, pathname))
    if (asset.startsWith(clientDir) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return file(res, asset, mime(asset))
    send(res, 404, { error: 'Not found' })
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : 'Server error' })
  }
}

function matchPath(pattern, pathname) {
  const a = pattern.split('/').filter(Boolean)
  const b = pathname.split('/').filter(Boolean)
  if (a.length !== b.length) return null
  const params = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i]
    else if (a[i] !== b[i]) return null
  }
  return params
}

function currentUser(req) {
  const sid = readCookie(req, 'signage_sid')
  if (!sid) return null
  const row = db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?`).get(sid, new Date().toISOString())
  return row ? { id: row.id, username: row.username, role: row.role } : null
}

function publicScreen(row, full = false) {
  const screen = {
    id: row.id, slug: row.slug, name: row.name, template: row.template, mode: JSON.parse(row.mode_json), turn: row.turn,
    presentation: JSON.parse(row.presentation_json), datasetId: row.dataset_id, version: row.version, loadCount: row.load_count, updatedAt: row.updated_at,
  }
  if (full) {
    screen.draft = JSON.parse(row.draft_json)
    screen.published = row.published_json ? JSON.parse(row.published_json) : null
  }
  return screen
}
function publicDataset(row) {
  return { id: row.id, name: row.name, kind: row.kind, rows: JSON.parse(row.rows_json), source: row.source, sourceUrl: row.source_url, intervalSec: row.interval_sec, lastFetch: row.last_fetch, lastError: row.last_error }
}
function publicAgency() {
  const row = agencyRow()
  return { timezone: row.timezone, weatherLat: row.weather_lat, weatherLon: row.weather_lon }
}
function publicOverride() {
  const row = db.prepare('SELECT * FROM overrides WHERE id = 1').get()
  return { active: Boolean(row.active), title: row.title, body: row.body, screenId: row.screen_id }
}
function payloadFor(row, source) {
  const screen = publicScreen(row, true)
  const datasets = new Map(listDatasets().map((item) => [item.id, JSON.parse(item.rows_json)]))
  return buildPayload({
    screen, source, now: new Date(), timezone: agencyRow().timezone, weather: freshWeather(),
    datasetRows: screen.datasetId ? datasets.get(screen.datasetId) || [] : [],
    datasets, allScreens: listScreens().map((item) => publicScreen(item, true)), override: publicOverride(),
  })
}
function freshWeather() {
  const row = agencyRow()
  if (!row.weather_json || !row.weather_at) return null
  if (Date.now() - Date.parse(row.weather_at) > 3600e3) return null
  return JSON.parse(row.weather_json)
}
async function refreshWeather() {
  const row = agencyRow()
  if (row.weather_lat == null || row.weather_lon == null) return
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${row.weather_lat}&longitude=${row.weather_lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
  const response = await fetch(url)
  if (!response.ok) return
  const body = await response.json()
  const summary = weatherText(body.current.weather_code)
  const reading = { tempF: Math.round(body.current.temperature_2m), summary, condition: summary, at: new Date().toISOString() }
  db.prepare('UPDATE agency SET weather_json = ?, weather_at = ?, weather_error = NULL WHERE id = 1').run(JSON.stringify(reading), reading.at)
}
function weatherText(code) {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Cloudy'
  if (code <= 48) return 'Fog'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  return 'Storms'
}
async function pullLanDatasets() {
  for (const row of listDatasets()) {
    if (row.source !== 'lan-http') continue
    const due = !row.last_fetch || Date.now() - Date.parse(row.last_fetch) > row.interval_sec * 1000
    if (due) await pullDataset(row)
  }
}
async function pullDataset(row) {
  try {
    if (!isPrivateUrl(row.source_url)) throw new Error('Private LAN address required')
    const response = await fetch(row.source_url)
    if (!response.ok) throw new Error(`Source returned ${response.status}`)
    const body = await response.json()
    const rows = Array.isArray(body) ? body : body.rows
    if (!Array.isArray(rows)) throw new Error('Source must return a list')
    db.prepare('UPDATE datasets SET rows_json = ?, last_fetch = ?, last_error = NULL WHERE id = ?').run(JSON.stringify(rows), new Date().toISOString(), row.id)
  } catch (error) {
    db.prepare('UPDATE datasets SET last_fetch = ?, last_error = ? WHERE id = ?').run(new Date().toISOString(), error instanceof Error ? error.message : 'Fetch failed', row.id)
  }
}
function ensureFirstAdmin() {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) return
  const setupFile = path.join(dataDir, 'setup-password.txt')
  const chosen = fs.existsSync(setupFile) ? fs.readFileSync(setupFile, 'utf8').trim() : String(process.env.SIGNAGE_ADMIN_PASSWORD || '')
  if (fs.existsSync(setupFile)) fs.rmSync(setupFile, { force: true })
  const password = chosen.length >= 8 ? chosen : crypto.randomBytes(9).toString('base64url')
  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), 'admin', hashPassword(password), 'admin')
  if (chosen.length >= 8) console.log('First admin created. Username: admin. The password is the one chosen during install.')
  else {
    fs.writeFileSync(path.join(dataDir, 'initial-password.txt'), `username: admin\npassword: ${password}\n`, { mode: 0o600 })
    console.log(`First admin created. Username: admin  Password: ${password}`)
  }
}
function ensureCertificates() {
  if (insecure || fs.existsSync(path.join(certDir, 'server.crt'))) return
  const openssl = findOpenssl()
  if (!openssl) { console.log('OpenSSL was not found, so HTTPS is off. Set SIGNAGE_INSECURE=1 or install OpenSSL.'); return }
  const cnf = path.join(certDir, 'server.cnf')
  const names = ['DNS:signage.local', 'DNS:localhost', ...lanAddresses().map((ip) => `IP:${ip}`), 'IP:127.0.0.1']
  fs.writeFileSync(cnf, `basicConstraints=CA:TRUE\n[req]\ndistinguished_name=dn\n[dn]\n[alt]\nsubjectAltName=${names.join(',')}\n`)
  spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(certDir, 'ca.key'), '-out', path.join(certDir, 'ca.crt'), '-days', '3650', '-nodes', '-subj', '/CN=Agency Signage Local CA'], { stdio: 'ignore' })
  spawnSync(openssl, ['req', '-newkey', 'rsa:2048', '-keyout', path.join(certDir, 'server.key'), '-out', path.join(certDir, 'server.csr'), '-nodes', '-subj', '/CN=signage.local'], { stdio: 'ignore' })
  spawnSync(openssl, ['x509', '-req', '-in', path.join(certDir, 'server.csr'), '-CA', path.join(certDir, 'ca.crt'), '-CAkey', path.join(certDir, 'ca.key'), '-CAcreateserial', '-out', path.join(certDir, 'server.crt'), '-days', '1825', '-extfile', cnf, '-extensions', 'alt'], { stdio: 'ignore' })
}
function findOpenssl() {
  for (const candidate of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe']) {
    const result = spawnSync(candidate, ['version'], { encoding: 'utf8' })
    if (result.status === 0) return candidate
  }
  return null
}
function backupDatabase() {
  db.exec('PRAGMA wal_checkpoint(FULL)')
  const file = path.join(backupDir, `signage-${new Date().toISOString().slice(0, 10)}.db`)
  fs.copyFileSync(databasePath, file)
  const files = fs.readdirSync(backupDir).filter((name) => name.endsWith('.db')).sort()
  while (files.length > 7) fs.rmSync(path.join(backupDir, files.shift()))
  fs.writeFileSync(path.join(dataDir, 'last-backup.txt'), new Date().toISOString())
  return file
}
function maybeDailyBackup() {
  const stamp = path.join(dataDir, 'last-backup.txt')
  if (fs.existsSync(stamp) && Date.now() - Date.parse(fs.readFileSync(stamp, 'utf8')) < 20 * 3600e3) return
  backupDatabase()
}
function diskFree() {
  try { return Number(fs.statfsSync(dataDir).bavail) * Number(fs.statfsSync(dataDir).bsize) } catch { return 1024 ** 4 }
}
function uniqueSlug(name) {
  const base = slugify(name)
  let slug = base
  let n = 2
  while (getScreenBySlug(slug)) slug = `${base}-${n++}`
  return slug
}
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen' }
function isPrivateUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.')) return true
    const match = /^172\.(\d+)\./.exec(host)
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
  } catch { return false }
}
function lanAddresses() {
  const found = []
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) found.push(item.address)
  return found
}
function cookie(id, req) {
  const secure = !insecure && req.socket.encrypted ? '; Secure' : ''
  return `signage_sid=${id}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${secure}`
}
function readCookie(req, name) {
  const source = req.headers.cookie || ''
  const found = source.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : ''
}
function isLoopback(req) {
  const ip = req.socket.remoteAddress || ''
  return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1')
}
function consumeToken(token) {
  const row = db.prepare('SELECT * FROM enroll_tokens WHERE token = ? AND used = 0 AND expires_at > ?').get(token, new Date().toISOString())
  if (!row) return null
  db.prepare('UPDATE enroll_tokens SET used = 1 WHERE token = ?').run(token)
  return row
}
function sendInstaller(req, res, kind) {
  const token = consumeToken(new URL(req.url, 'http://local').searchParams.get('token'))
  if (!token) return send(res, 400, { error: 'Setup link expired. Create a new one from the display.' })
  const screen = token.screen_id ? getScreen(token.screen_id) : null
  const script = kioskScript(kind, token, screen, req)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(script)
}
function kioskScript(kind, token, screen, req) {
  const host = (req.headers.host || `signage.local:${httpsPort}`).replace(/:\d+$/, '')
  const base = insecure ? `http://${host}:${httpPort}` : `https://${host}:${httpsPort}`
  const screenUrl = screen ? `${base}/screen/${screen.slug}` : `${base}/setup`
  const [hour, minute] = String(token.restart_time || '03:00').split(':')
  const rotate = token.turn === 'clockwise' ? 'right' : token.turn === 'counterclockwise' ? 'left' : 'normal'
  const mode = screen ? JSON.parse(screen.mode_json) : { width: 1920, height: 1080 }
  if (kind === 'ps1') {
    return `$url = '${screenUrl}'\nImport-Certificate -FilePath (Join-Path $PSScriptRoot 'ca.crt') -CertStoreLocation Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue\npowercfg /change monitor-timeout-ac 0\npowercfg /change standby-timeout-ac 0\n$chrome = "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe"\nif (!(Test-Path $chrome)) { $chrome = "$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe" }\n& $chrome --kiosk $url --force-device-scale-factor=1 --no-first-run\nschtasks /Create /TN AgencySignageKiosk /SC ONLOGON /TR "powershell -File $PSCommandPath" /F\nschtasks /Create /TN AgencySignageKioskRestart /SC DAILY /ST ${hour || '03'}:${minute || '00'} /TR "powershell -File $PSCommandPath" /F\n`
  }
  return `#!/bin/bash
set -euo pipefail
SCREEN_URL=${shellQuote(screenUrl)}
CA_URL=${shellQuote(`${base}/setup/ca.crt`)}
sudo apt-get update
sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
curl -fsSL "$CA_URL" -o /tmp/agency-signage-ca.crt
sudo cp /tmp/agency-signage-ca.crt /usr/local/share/ca-certificates/agency-signage.crt
sudo update-ca-certificates || true
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Agency Signage" -i /tmp/agency-signage-ca.crt || true
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/agency-signage-kiosk.service" <<UNIT
[Unit]
Description=Agency signage kiosk
[Service]
Environment=DISPLAY=:0
ExecStartPre=/bin/sh -c 'xset s off; xset -dpms; xset s noblank; wlr-randr --output HDMI-A-1 --mode ${mode.width}x${mode.height} --transform ${rotate} || xrandr --output HDMI-1 --mode ${mode.width}x${mode.height} --rotate ${rotate} || true'
ExecStart=/bin/sh -c 'while true; do chromium-browser --kiosk --force-device-scale-factor=1 --noerrdialogs --disable-infobars --check-for-update-interval=31536000 "$SCREEN_URL" || chromium --kiosk --force-device-scale-factor=1 "$SCREEN_URL"; sleep 2; done'
Restart=always
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now agency-signage-kiosk.service
(crontab -l 2>/dev/null | grep -v agency-signage-kiosk; echo "${minute || '0'} ${hour || '3'} * * * systemctl --user restart agency-signage-kiosk.service") | crontab -
echo "Kiosk started. Maintenance: Ctrl+Alt+F2 then systemctl --user stop agency-signage-kiosk.service"
`
}
function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'` }
function stripMetadata(data, mime) {
  if (mime === 'image/png' || data.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return { data, mime: 'image/png' }
  const chunks = []
  let i = 2
  if (data[0] !== 0xff || data[1] !== 0xd8) return { data, mime: 'image/jpeg' }
  chunks.push(data.subarray(0, 2))
  while (i < data.length) {
    if (data[i] !== 0xff) break
    const marker = data[i + 1]
    if (marker === 0xda) { chunks.push(data.subarray(i)); break }
    const size = data.readUInt16BE(i + 2)
    if (marker !== 0xe1) chunks.push(data.subarray(i, i + 2 + size))
    i += 2 + size
  }
  return { data: Buffer.concat(chunks), mime: 'image/jpeg' }
}
function file(res, target, type) {
  res.writeHead(200, { 'Content-Type': type })
  res.end(fs.readFileSync(target))
}
function mime(filePath) {
  const ext = path.extname(filePath)
  return { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream'
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
function readJson(req) {
  return readRaw(req).then((buf) => buf.length ? JSON.parse(buf.toString('utf8')) : {})
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
async function readForm(req) {
  const raw = await readRaw(req)
  const type = req.headers['content-type'] || ''
  const boundary = /boundary=(.+)$/.exec(type)?.[1]
  const fields = {}
  const files = {}
  if (!boundary) return { fields, files }
  for (const part of raw.toString('latin1').split(`--${boundary}`)) {
    const split = part.indexOf('\r\n\r\n')
    if (split < 0) continue
    const head = part.slice(0, split)
    const body = part.slice(split + 4).replace(/\r\n$/, '')
    const name = /name="([^"]+)"/.exec(head)?.[1]
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    if (!name) continue
    let payload = body
    if (payload.endsWith('--')) payload = payload.slice(0, -2)
    if (payload.endsWith('\r\n')) payload = payload.slice(0, -2)
    if (filename) files[name] = { name: filename, mime: /Content-Type: ([^\r]+)/.exec(head)?.[1] || 'application/octet-stream', data: Buffer.from(payload, 'latin1') }
    else fields[name] = payload
  }
  return { fields, files }
}
