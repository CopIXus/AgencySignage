import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import crypto from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { hashPassword, verifyPassword } from './password'
import sharp from 'sharp'
import { cardsFromCsv } from '../shared/csv'
import { datasetKindFor, emptyDraft, presentationDefaults } from '../shared/defaults'
import { closestMode, DISPLAY_MODES, resolveMode } from '../shared/modes'
import { clockLooksWrong } from '../shared/schedule'
import type { CardItem, DatasetKind, Honoree, Role, ScreenDraft, SlideItem, TemplateKind, Turn } from '../shared/types'
import { ensureCertificates } from './certs'
import {
  agencyRow,
  certDir,
  dataDir,
  database,
  getDataset,
  getScreen,
  getScreenBySlug,
  getUserByUsername,
  listDatasets,
  listScreens,
  listUsers,
  mediaDir,
  openDatabase,
  rootDir,
  type DatasetRow,
  type ScreenRow,
  type UserRow,
} from './db'
import { linuxKioskScript, windowsKioskScript } from './kiosk'
import { buildPayload, parseDataset, parseScreen } from './payload'
import { backupDatabase, diskFreeBytes, isPrivateHost, lanAddresses, maybeDailyBackup, uniqueSlug } from './util'
import { freshWeather, refreshWeather } from './weather'

const httpPort = Number(process.env.SIGNAGE_HTTP_PORT || 8080)
const httpsPort = Number(process.env.SIGNAGE_HTTPS_PORT || 8443)
const insecure = process.env.SIGNAGE_INSECURE === '1'
const clientDir = path.join(rootDir, 'dist', 'client')

openDatabase()
await ensureFirstAdmin()
maybeDailyBackup()

const hosts = lanAddresses()
const tls = insecure ? null : ensureCertificates(hosts)
const app = Fastify({ logger: false, https: tls ? { key: tls.key, cert: tls.cert } : null })
await app.register(cookie)
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } })

function publicOrigin(request: FastifyRequest): string {
  const hostHeader = request.headers.host || `localhost:${tls ? httpsPort : httpPort}`
  const hostname = hostHeader.split(':')[0]
  const port = tls ? httpsPort : httpPort
  const scheme = tls ? 'https' : 'http'
  const portSuffix = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`
  return `${scheme}://${hostname}${portSuffix}`
}

async function currentUser(request: FastifyRequest): Promise<UserRow | null> {
  const sid = request.cookies.signage_sid
  if (!sid) return null
  const row = database().prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?`).get(sid, new Date().toISOString()) as UserRow | undefined
  return row || null
}

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<UserRow | null> {
  const user = await currentUser(request)
  if (!user) {
    reply.code(401).send({ error: 'Sign in required' })
    return null
  }
  return user
}

function requireAdmin(user: UserRow, reply: FastifyReply): boolean {
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'An administrator has to do that' })
    return false
  }
  return true
}

function readRows(screen: ScreenRow): unknown[] {
  if (!screen.dataset_id) return []
  const dataset = getDataset(screen.dataset_id)
  return dataset ? JSON.parse(dataset.rows_json) as unknown[] : []
}

function context(now = new Date()) {
  const agency = agencyRow()
  const screens = listScreens().map(parseScreen)
  const datasets = new Map<string, unknown[]>()
  for (const dataset of listDatasets()) datasets.set(dataset.id, JSON.parse(dataset.rows_json) as unknown[])
  const overrideRow = database().prepare('SELECT * FROM overrides WHERE id = 1').get() as { active: number; title: string; body: string; screen_id: string | null }
  return {
    timezone: agency.timezone,
    weather: freshWeather(),
    screens,
    datasets,
    override: { active: overrideRow.active === 1, title: overrideRow.title, body: overrideRow.body, screenId: overrideRow.screen_id },
    now,
  }
}

function payloadFor(row: ScreenRow, source: 'draft' | 'published') {
  const ctx = context()
  return buildPayload({
    screen: parseScreen(row),
    source,
    datasetRows: readRows(row),
    allScreens: ctx.screens,
    datasets: ctx.datasets,
    now: ctx.now,
    timezone: ctx.timezone,
    weather: ctx.weather,
    override: ctx.override,
  })
}

app.post('/api/login', async (request, reply) => {
  const body = request.body as { username?: string; password?: string }
  const user = getUserByUsername(String(body.username || ''))
  const ok = user ? verifyPassword(String(body.password || ''), user.password_hash) : false
  if (!user || !ok) return reply.code(401).send({ error: 'Those credentials were not recognized' })
  const sid = crypto.randomUUID()
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  database().prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sid, user.id, expires)
  reply.setCookie('signage_sid', sid, { httpOnly: true, sameSite: 'lax', path: '/', secure: Boolean(tls), expires: new Date(expires) })
  return { id: user.id, username: user.username, role: user.role }
})

app.post('/api/logout', async (request, reply) => {
  if (request.cookies.signage_sid) database().prepare('DELETE FROM sessions WHERE id = ?').run(request.cookies.signage_sid)
  reply.clearCookie('signage_sid', { path: '/' })
  return { ok: true }
})

app.get('/api/me', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  return { id: user.id, username: user.username, role: user.role }
})

app.post('/api/me/password', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = request.body as { current?: string; next?: string }
  const ok = verifyPassword(String(body.current || ''), user.password_hash)
  if (!ok) return reply.code(400).send({ error: 'Current password is wrong' })
  if (!body.next || body.next.length < 8) return reply.code(400).send({ error: 'Use at least 8 characters' })
  database().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), user.id)
  return { ok: true }
})

app.get('/api/dashboard', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const now = new Date()
  const players = database().prepare('SELECT * FROM players').all() as { id: string; device_name: string; screen_slug: string; last_seen: string; reported_version: number; width: number; height: number; dpr: number }[]
  const publishes = database().prepare('SELECT * FROM publishes ORDER BY published_at DESC LIMIT 40').all()
  return {
    now: now.toISOString(),
    clockWarning: clockLooksWrong(now),
    diskFreeBytes: diskFreeBytes(),
    screens: listScreens().map((screen) => {
      const mode = JSON.parse(screen.mode_json) as { width: number; height: number }
      return {
        ...screenSummary(screen),
        players: players.filter((player) => player.screen_slug === screen.slug).map((player) => ({
          ...player,
          inUse: Date.now() - new Date(player.last_seen).getTime() < 30_000,
          current: player.reported_version === screen.version,
          resolutionMatches: Math.abs(player.width - mode.width) < 80 && Math.abs(player.height - mode.height) < 80,
        })),
      }
    }),
    publishes,
  }
})

app.get('/api/screens', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  return listScreens().map(screenSummary)
})

app.post('/api/screens', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = request.body as { name?: string; template?: TemplateKind; modeId?: string; width?: number; height?: number; datasetId?: string | null }
  const template = body.template
  if (!template || !['award', 'directory', 'slides', 'playlist'].includes(template)) return reply.code(400).send({ error: 'Choose a template' })
  const mode = resolveMode({ id: body.modeId, width: body.width, height: body.height })
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  let datasetId = body.datasetId || null
  const kind = datasetKindFor(template)
  if (kind && !datasetId) {
    datasetId = crypto.randomUUID()
    database().prepare(`INSERT INTO datasets (id, name, kind, rows_json, source) VALUES (?, ?, ?, '[]', 'manual')`).run(datasetId, `${body.name || template} data`, kind)
  }
  if (datasetId) {
    const dataset = getDataset(datasetId)
    if (!dataset || (kind && dataset.kind !== kind)) return reply.code(400).send({ error: 'That data set does not match this screen' })
  }
  database().prepare(`INSERT INTO screens (id, slug, name, template, mode_json, turn, presentation_json, dataset_id, draft_json, published_json, version, load_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'counterclockwise', ?, ?, ?, NULL, 0, 0, ?, ?)`).run(
    id,
    uniqueSlug(body.name || template),
    body.name || 'Untitled screen',
    template,
    JSON.stringify(mode),
    JSON.stringify(presentationDefaults(template)),
    datasetId,
    JSON.stringify(emptyDraft(template)),
    now,
    now,
  )
  return screenSummary(getScreen(id)!)
})

app.get('/api/screens/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screen = getScreen((request.params as { id: string }).id)
  if (!screen) return reply.code(404).send({ error: 'Screen not found' })
  return { ...screenSummary(screen), draft: JSON.parse(screen.draft_json), presentation: JSON.parse(screen.presentation_json), mode: JSON.parse(screen.mode_json) }
})

app.put('/api/screens/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screen = getScreen((request.params as { id: string }).id)
  if (!screen) return reply.code(404).send({ error: 'Screen not found' })
  const body = request.body as { name?: string; draft?: ScreenDraft; presentation?: unknown; modeId?: string; width?: number; height?: number; turn?: Turn; datasetId?: string | null }
  const mode = body.modeId || body.width ? resolveMode({ id: body.modeId, width: body.width, height: body.height }) : JSON.parse(screen.mode_json)
  database().prepare(`UPDATE screens SET name = ?, draft_json = ?, presentation_json = ?, mode_json = ?, turn = ?, dataset_id = ?, updated_at = ? WHERE id = ?`).run(
    body.name || screen.name,
    JSON.stringify(body.draft ?? JSON.parse(screen.draft_json)),
    JSON.stringify(body.presentation ?? JSON.parse(screen.presentation_json)),
    JSON.stringify(mode),
    body.turn || screen.turn,
    body.datasetId === undefined ? screen.dataset_id : body.datasetId,
    new Date().toISOString(),
    screen.id,
  )
  return { ok: true }
})

app.delete('/api/screens/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  database().prepare('DELETE FROM screens WHERE id = ?').run((request.params as { id: string }).id)
  return { ok: true }
})

app.post('/api/screens/:id/publish', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screen = getScreen((request.params as { id: string }).id)
  if (!screen) return reply.code(404).send({ error: 'Screen not found' })
  const version = screen.version + 1
  database().prepare(`UPDATE screens SET published_json = draft_json, version = ?, updated_at = ? WHERE id = ?`).run(version, new Date().toISOString(), screen.id)
  database().prepare(`INSERT INTO publishes (id, screen_id, user_id, username, version, published_at) VALUES (?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), screen.id, user.id, user.username, version, new Date().toISOString())
  return { version }
})

app.post('/api/screens/:id/revert', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screen = getScreen((request.params as { id: string }).id)
  if (!screen?.published_json) return reply.code(400).send({ error: 'Nothing has been published yet' })
  database().prepare('UPDATE screens SET draft_json = published_json, updated_at = ? WHERE id = ?').run(new Date().toISOString(), screen.id)
  return { ok: true }
})

app.post('/api/screens/:id/move-to-history', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screen = getScreen((request.params as { id: string }).id)
  if (!screen || screen.template !== 'award' || !screen.dataset_id) return reply.code(400).send({ error: 'This screen has no honoree history' })
  const draft = JSON.parse(screen.draft_json) as { current: { name: string; badgeNumber: string; awardYear: string; photoId: string | null; rank: string; hireDate: string; yearsOfService: string } }
  if (!draft.current.name) return reply.code(400).send({ error: 'Enter the current honoree first' })
  const dataset = getDataset(screen.dataset_id)!
  const rows = JSON.parse(dataset.rows_json) as Honoree[]
  rows.unshift({ id: crypto.randomUUID(), name: draft.current.name, badgeNumber: draft.current.badgeNumber, awardYear: draft.current.awardYear })
  database().prepare('UPDATE datasets SET rows_json = ? WHERE id = ?').run(JSON.stringify(rows), dataset.id)
  draft.current = { name: '', badgeNumber: '', awardYear: '', rank: '', hireDate: '', yearsOfService: '', photoId: null }
  database().prepare('UPDATE screens SET draft_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(draft), new Date().toISOString(), screen.id)
  return { ok: true }
})

app.get('/api/datasets', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const screens = listScreens()
  return listDatasets().map((dataset) => ({
    ...publicDataset(dataset),
    screens: screens.filter((screen) => screen.dataset_id === dataset.id).map((screen) => ({ id: screen.id, name: screen.name })),
  }))
})

app.post('/api/datasets', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = request.body as { name?: string; kind?: DatasetKind }
  if (!body.kind || !['honorees', 'cards', 'slides'].includes(body.kind)) return reply.code(400).send({ error: 'Choose a data set kind' })
  const id = crypto.randomUUID()
  database().prepare(`INSERT INTO datasets (id, name, kind, rows_json, source) VALUES (?, ?, ?, '[]', 'manual')`).run(id, body.name || 'Untitled', body.kind)
  return publicDataset(getDataset(id)!)
})

app.put('/api/datasets/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const dataset = getDataset((request.params as { id: string }).id)
  if (!dataset) return reply.code(404).send({ error: 'Data set not found' })
  const body = request.body as { name?: string; rows?: unknown[]; source?: string; sourceUrl?: string; intervalSec?: number }
  if (body.source === 'lan-http' && body.sourceUrl && !privateUrl(body.sourceUrl)) return reply.code(400).send({ error: 'That address is not on the internal network' })
  const rows = body.rows ? normalizeRows(dataset.kind, body.rows) : JSON.parse(dataset.rows_json)
  database().prepare(`UPDATE datasets SET name = ?, rows_json = ?, source = ?, source_url = ?, interval_sec = ?, last_error = NULL WHERE id = ?`).run(
    body.name || dataset.name,
    JSON.stringify(rows),
    body.source || dataset.source,
    body.sourceUrl ?? dataset.source_url,
    body.intervalSec || dataset.interval_sec,
    dataset.id,
  )
  return { ok: true }
})

app.post('/api/datasets/:id/import', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const dataset = getDataset((request.params as { id: string }).id)
  if (!dataset || dataset.kind !== 'cards') return reply.code(400).send({ error: 'CSV import is for card lists' })
  const body = request.body as { csv?: string; replace?: boolean }
  const rows = cardsFromCsv(String(body.csv || ''), JSON.parse(dataset.rows_json) as CardItem[], Boolean(body.replace))
  database().prepare(`UPDATE datasets SET rows_json = ? WHERE id = ?`).run(JSON.stringify(rows), dataset.id)
  return { count: rows.length }
})

app.post('/api/datasets/:id/fetch', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const dataset = getDataset((request.params as { id: string }).id)
  if (!dataset) return reply.code(404).send({ error: 'Data set not found' })
  try {
    await pullDataset(dataset)
    return { ok: true }
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Fetch failed' })
  }
})

app.get('/api/media', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  return database().prepare('SELECT id, folder, filename, mime, bytes, created_at FROM media ORDER BY created_at DESC').all()
})

app.post('/api/media', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  if (diskFreeBytes() < 500 * 1024 * 1024) return reply.code(507).send({ error: 'The Pi is low on free space' })
  const file = await request.file()
  if (!file) return reply.code(400).send({ error: 'Choose an image' })
  const folderField = file.fields.folder as { value?: string } | undefined
  const folder = folderField?.value || 'photos'
  const input = await file.toBuffer()
  const png = file.mimetype === 'image/png'
  const pipeline = sharp(input, { failOn: 'none' }).rotate().resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true })
  const output = png ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 85 }).toBuffer()
  const id = crypto.randomUUID()
  const filename = `${id}${png ? '.png' : '.jpg'}`
  fs.writeFileSync(path.join(mediaDir, filename), output)
  database().prepare('INSERT INTO media (id, folder, filename, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, folder, file.filename || filename, png ? 'image/png' : 'image/jpeg', output.length, new Date().toISOString())
  return { id, folder }
})

app.get('/media/:id', async (request, reply) => {
  const row = database().prepare('SELECT * FROM media WHERE id = ?').get((request.params as { id: string }).id) as { filename: string; mime: string } | undefined
  if (!row) return reply.code(404).send({ error: 'Missing media' })
  reply.type(row.mime).header('cache-control', 'public, max-age=86400')
  return reply.send(fs.readFileSync(path.join(mediaDir, row.filename)))
})

app.delete('/api/media/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const id = (request.params as { id: string }).id
  const row = database().prepare('SELECT * FROM media WHERE id = ?').get(id) as { filename: string } | undefined
  if (row) fs.rmSync(path.join(mediaDir, row.filename), { force: true })
  database().prepare('DELETE FROM media WHERE id = ?').run(id)
  return { ok: true }
})

app.get('/api/agency', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const row = agencyRow()
  return { timezone: row.timezone, weatherLat: row.weather_lat, weatherLon: row.weather_lon, weatherError: row.weather_error, weatherAt: row.weather_at }
})

app.put('/api/agency', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  const body = request.body as { timezone?: string; weatherLat?: number | null; weatherLon?: number | null }
  database().prepare('UPDATE agency SET timezone = ?, weather_lat = ?, weather_lon = ? WHERE id = 1').run(body.timezone || 'America/Detroit', body.weatherLat ?? null, body.weatherLon ?? null)
  if (body.weatherLat != null && body.weatherLon != null) await refreshWeather()
  return { ok: true }
})

app.get('/api/users', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  return listUsers().map(({ id, username, role }) => ({ id, username, role }))
})

app.post('/api/users', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  const body = request.body as { username?: string; password?: string; role?: Role }
  if (!body.username || !body.password || body.password.length < 8) return reply.code(400).send({ error: 'Username and a password of at least 8 characters are required' })
  const id = crypto.randomUUID()
  database().prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(id, body.username, hashPassword(body.password), body.role === 'admin' ? 'admin' : 'editor')
  return { id }
})

app.delete('/api/users/:id', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  const id = (request.params as { id: string }).id
  if (id === user.id) return reply.code(400).send({ error: 'You cannot remove yourself' })
  database().prepare('DELETE FROM users WHERE id = ?').run(id)
  return { ok: true }
})

app.get('/api/override', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  return database().prepare('SELECT active, title, body, screen_id as screenId FROM overrides WHERE id = 1').get()
})

app.put('/api/override', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = request.body as { active?: boolean; title?: string; body?: string; screenId?: string | null }
  database().prepare('UPDATE overrides SET active = ?, title = ?, body = ?, screen_id = ? WHERE id = 1').run(body.active ? 1 : 0, body.title || '', body.body || '', body.screenId || null)
  return { ok: true }
})

app.get('/api/modes', async () => ({ modes: DISPLAY_MODES }))

app.get('/api/public/screens/:slug', async (request, reply) => {
  const slug = (request.params as { slug: string }).slug
  const query = request.query as { version?: string; preview?: string; load?: string; playerId?: string; deviceName?: string; width?: string; height?: string; dpr?: string }
  const screen = getScreenBySlug(slug)
  if (!screen) return reply.code(404).send({ error: 'Screen not found' })
  const preview = query.preview === '1'
  if (!preview && query.load === '1') database().prepare('UPDATE screens SET load_count = load_count + 1 WHERE id = ?').run(screen.id)
  if (!preview && query.playerId) {
    database().prepare(`INSERT INTO players (id, device_name, screen_slug, last_seen, reported_version, width, height, dpr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET device_name = excluded.device_name, screen_slug = excluded.screen_slug, last_seen = excluded.last_seen, reported_version = excluded.reported_version, width = excluded.width, height = excluded.height, dpr = excluded.dpr`).run(
      query.playerId,
      query.deviceName || 'Display',
      slug,
      new Date().toISOString(),
      Number(query.version || screen.version),
      Number(query.width || 0),
      Number(query.height || 0),
      Number(query.dpr || 1),
    )
  }
  if (!preview && query.version && Number(query.version) === screen.version && screen.version > 0) {
    const parsed = parseScreen(screen)
    return { unchanged: true, version: screen.version, serverNow: new Date().toISOString(), weather: parsed.presentation.showWeather ? freshWeather() : null }
  }
  reply.header('cache-control', 'no-store')
  return payloadFor(screen, preview ? 'draft' : 'published')
})

app.get('/api/admin/backup', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  backupDatabase()
  const archive = path.join(dataDir, 'signage-backup.zip')
  await runTar(['-a', '-c', '-f', archive, '-C', dataDir, 'signage.db', 'media'])
  reply.header('content-disposition', 'attachment; filename="signage-backup.zip"')
  return reply.type('application/zip').send(fs.readFileSync(archive))
})

app.post('/api/admin/restore', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user || !requireAdmin(user, reply)) return
  const file = await request.file()
  if (!file) return reply.code(400).send({ error: 'Choose a backup zip' })
  const archive = path.join(dataDir, 'restore.zip')
  await pipeline(file.file, fs.createWriteStream(archive))
  const staging = path.join(dataDir, 'restore-staging')
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  await runTar(['-x', '-f', archive, '-C', staging])
  const dbFile = path.join(staging, 'signage.db')
  if (!fs.existsSync(dbFile)) return reply.code(400).send({ error: 'That archive has no signage database' })
  database().close()
  fs.copyFileSync(dbFile, path.join(dataDir, 'signage.db'))
  const stagedMedia = path.join(staging, 'media')
  if (fs.existsSync(stagedMedia)) {
    fs.rmSync(mediaDir, { recursive: true, force: true })
    fs.cpSync(stagedMedia, mediaDir, { recursive: true })
  }
  openDatabase()
  return { ok: true }
})

app.post('/api/admin/enroll', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const body = request.body as { screenId?: string; deviceName?: string; restartTime?: string; turn?: Turn }
  const token = crypto.randomBytes(18).toString('hex')
  database().prepare(`INSERT INTO enroll_tokens (token, screen_id, device_name, restart_time, turn, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    token,
    body.screenId || null,
    body.deviceName || 'Display',
    body.restartTime || '03:00',
    body.turn || 'counterclockwise',
    new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  )
  const origin = publicOrigin(request)
  return {
    token,
    linux: `curl -fsSL "${origin}/setup/install.sh?token=${token}" | bash`,
    windows: `${origin}/setup/install.ps1?token=${token}`,
  }
})

app.get('/setup/install.sh', async (request, reply) => {
  const script = kioskScriptFor(request, 'linux')
  if (typeof script !== 'string') return reply.code(script.code).send({ error: script.error })
  reply.type('text/x-shellscript')
  return script
})

app.get('/setup/install.ps1', async (request, reply) => {
  const script = kioskScriptFor(request, 'windows')
  if (typeof script !== 'string') return reply.code(script.code).send({ error: script.error })
  reply.type('text/plain')
  return script
})

app.get('/setup/ca.crt', async (_request, reply) => {
  const file = path.join(certDir, 'ca.crt')
  if (!fs.existsSync(file)) return reply.code(404).send('No local certificate yet')
  return reply.type('application/x-x509-ca-cert').send(fs.readFileSync(file))
})

app.post('/api/admin/kiosk/install', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const address = request.ip
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    return reply.code(403).send({ error: 'This button only runs on the machine that hosts signage. Use the install command on the other device.' })
  }
  const body = request.body as { token?: string }
  const tokenRow = consumeToken(String(body.token || ''))
  if (!tokenRow) return reply.code(400).send({ error: 'That setup link has expired' })
  const screen = tokenRow.screen_id ? getScreen(tokenRow.screen_id) : undefined
  const origin = publicOrigin(request)
  const screenUrl = screen ? `${origin}/screen/${screen.slug}` : origin
  const win = process.platform === 'win32'
  const file = path.join(dataDir, win ? 'kiosk-install.ps1' : 'kiosk-install.sh')
  const script = win
    ? windowsKioskScript({ screenUrl, caUrl: `${origin}/setup/ca.crt`, restartTime: tokenRow.restart_time })
    : linuxKioskScript({
      screenUrl,
      caUrl: `${origin}/setup/ca.crt`,
      restartTime: tokenRow.restart_time,
      width: screen ? JSON.parse(screen.mode_json).width : 1920,
      height: screen ? JSON.parse(screen.mode_json).height : 1080,
      turn: tokenRow.turn as Turn,
    })
  fs.writeFileSync(file, script)
  const child = win
    ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: dataDir })
    : spawn('bash', [file], { cwd: dataDir })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk.toString() })
  child.stderr.on('data', (chunk) => { log += chunk.toString() })
  const code = await new Promise<number>((resolve) => child.on('close', (value) => resolve(value ?? 1)))
  return { code, log }
})

app.get('/api/setup/suggest', async (request) => {
  const query = request.query as { width?: string; height?: string }
  return { recommended: closestMode(Number(query.width || 1920), Number(query.height || 1080)), modes: DISPLAY_MODES, hostname: os.hostname() }
})

function kioskScriptFor(request: FastifyRequest, platform: 'linux' | 'windows'): string | { code: number; error: string } {
  const query = request.query as { token?: string }
  const tokenRow = consumeToken(String(query.token || ''))
  if (!tokenRow) return { code: 400, error: 'That setup link has expired' }
  const screen = tokenRow.screen_id ? getScreen(tokenRow.screen_id) : undefined
  const origin = publicOrigin(request)
  const screenUrl = screen ? `${origin}/screen/${screen.slug}` : `${origin}/setup`
  const mode = screen ? JSON.parse(screen.mode_json) as { width: number; height: number } : { width: 1920, height: 1080 }
  if (platform === 'windows') return windowsKioskScript({ screenUrl, caUrl: `${origin}/setup/ca.crt`, restartTime: tokenRow.restart_time })
  return linuxKioskScript({
    screenUrl,
    caUrl: `${origin}/setup/ca.crt`,
    restartTime: tokenRow.restart_time,
    width: mode.width,
    height: mode.height,
    turn: (screen?.turn || tokenRow.turn) as Turn,
  })
}

function consumeToken(token: string) {
  const row = database().prepare(`SELECT * FROM enroll_tokens WHERE token = ? AND used = 0 AND expires_at > ?`).get(token, new Date().toISOString()) as { token: string; screen_id: string | null; device_name: string; restart_time: string; turn: string } | undefined
  if (!row) return null
  database().prepare('UPDATE enroll_tokens SET used = 1 WHERE token = ?').run(token)
  return row
}

function screenSummary(screen: ScreenRow) {
  return {
    id: screen.id,
    slug: screen.slug,
    name: screen.name,
    template: screen.template,
    turn: screen.turn,
    mode: JSON.parse(screen.mode_json),
    datasetId: screen.dataset_id,
    version: screen.version,
    loadCount: screen.load_count,
    published: Boolean(screen.published_json),
    updatedAt: screen.updated_at,
  }
}

function publicDataset(dataset: DatasetRow) {
  const rows = JSON.parse(dataset.rows_json) as unknown[]
  return { ...parseDataset(dataset), count: rows.length, rows }
}

function privateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && isPrivateHost(url.hostname)
  } catch {
    return false
  }
}

function normalizeRows(kind: DatasetKind, rows: unknown[]): unknown[] {
  if (kind === 'cards') {
    return (rows as CardItem[]).map((row) => ({
      id: row.id || crypto.randomUUID(),
      name: String(row.name || ''),
      subtitle: String(row.subtitle || ''),
      phone: String(row.phone || ''),
      details: String(row.details || ''),
      logoId: row.logoId || null,
    })).sort((a, b) => a.name.localeCompare(b.name))
  }
  if (kind === 'honorees') {
    return (rows as Honoree[]).map((row) => ({
      id: row.id || crypto.randomUUID(),
      name: String(row.name || ''),
      badgeNumber: String(row.badgeNumber || ''),
      awardYear: String(row.awardYear || ''),
    }))
  }
  return (rows as SlideItem[]).map((row) => ({
    id: row.id || crypto.randomUUID(),
    kind: row.kind || 'mixed',
    title: String(row.title || ''),
    bodyHtml: String(row.bodyHtml || ''),
    qrUrl: String(row.qrUrl || ''),
    qrLabel: String(row.qrLabel || ''),
    imageId: row.imageId || null,
    durationSec: Number(row.durationSec || 15),
    days: Array.isArray(row.days) ? row.days.map(Number) : [],
    startTime: String(row.startTime || ''),
    endTime: String(row.endTime || ''),
  }))
}

async function pullDataset(dataset: DatasetRow): Promise<void> {
  if (!dataset.source_url || !privateUrl(dataset.source_url)) throw new Error('Set an internal network address first')
  const response = await fetch(dataset.source_url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`The data source returned ${response.status}`)
  const body = await response.json() as unknown
  if (!Array.isArray(body)) throw new Error('The data source must return a JSON array')
  const rows = normalizeRows(dataset.kind, body)
  database().prepare(`UPDATE datasets SET rows_json = ?, last_fetch = ?, last_error = NULL WHERE id = ?`).run(JSON.stringify(rows), new Date().toISOString(), dataset.id)
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { cwd: dataDir })
    let err = ''
    child.stderr.on('data', (chunk) => { err += chunk.toString() })
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `tar exited ${code}`)))
  })
}

async function ensureFirstAdmin(): Promise<void> {
  if (listUsers().length > 0) return
  const password = crypto.randomBytes(9).toString('base64url')
  database().prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, 'admin', ?, 'admin')`).run(crypto.randomUUID(), hashPassword(password))
  const note = path.join(dataDir, 'initial-password.txt')
  fs.writeFileSync(note, `username: admin\npassword: ${password}\n`)
  console.log(`First administrator created. Username: admin  Password: ${password}`)
  console.log(`Saved to ${note}`)
}

function sendHtml(reply: FastifyReply, name: string) {
  const file = path.join(clientDir, name)
  if (!fs.existsSync(file)) return reply.code(503).type('text/plain').send('Run npm run build so the pages are available.')
  return reply.type('text/html').send(fs.readFileSync(file))
}

app.get('/admin', async (_request, reply) => sendHtml(reply, 'admin.html'))
app.get('/admin/*', async (_request, reply) => sendHtml(reply, 'admin.html'))
app.get('/screen/:slug', async (_request, reply) => sendHtml(reply, 'display.html'))
app.get('/setup', async (_request, reply) => sendHtml(reply, 'setup.html'))
app.get('/', async (_request, reply) => reply.redirect('/admin'))
app.get('/assets/*', async (request, reply) => {
  const rel = (request.params as { '*': string })['*']
  const file = path.resolve(clientDir, 'assets', rel)
  const assets = path.resolve(clientDir, 'assets')
  if (!file.startsWith(assets) || !fs.existsSync(file)) return reply.code(404).send()
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
  return reply.type(types[path.extname(file)] || 'application/octet-stream').send(fs.readFileSync(file))
})

setInterval(() => { void refreshWeather() }, 20 * 60 * 1000)
setInterval(() => { void refreshLanDatasets() }, 60 * 1000)
setInterval(() => { maybeDailyBackup() }, 60 * 60 * 1000)
void refreshWeather()

async function refreshLanDatasets(): Promise<void> {
  const now = Date.now()
  for (const dataset of listDatasets()) {
    if (dataset.source !== 'lan-http' || !dataset.source_url) continue
    const last = dataset.last_fetch ? Date.parse(dataset.last_fetch) : 0
    if (now - last < dataset.interval_sec * 1000) continue
    try {
      await pullDataset(dataset)
    } catch (error) {
      database().prepare('UPDATE datasets SET last_error = ?, last_fetch = ? WHERE id = ?').run(error instanceof Error ? error.message : 'Fetch failed', new Date().toISOString(), dataset.id)
    }
  }
}

const listenPort = tls ? httpsPort : httpPort
await app.listen({ port: listenPort, host: '0.0.0.0' })
console.log(`Signage listening on ${tls ? 'https' : 'http'}://0.0.0.0:${listenPort}`)
if (tls) {
  http.createServer((req, res) => {
    const host = (req.headers.host || 'signage.local').split(':')[0]
    res.writeHead(302, { Location: `https://${host}:${httpsPort}${req.url || '/'}` })
    res.end()
  }).listen(httpPort, '0.0.0.0')
  console.log(`HTTP on port ${httpPort} redirects to HTTPS`)
}
