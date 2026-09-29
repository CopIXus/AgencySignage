import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { DISPLAY_MODES } from '@shared/modes'
import type { AwardDraft, CardItem, DirectoryDraft, PlaylistDraft, PlaylistEntry, Presentation, ScreenDraft, SlideItem, SlidesDraft } from '@shared/types'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body as T
}

export function App() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    api<{ username: string; role: string }>('/api/me').then(setUser).catch(() => setUser(null)).finally(() => setReady(true))
  }, [])
  if (!ready) return null
  if (!user) return <Login onDone={setUser} />
  return (
    <div className="shell">
      <nav>
        <strong>Agency Signage</strong>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/screens">Screens</NavLink>
        <NavLink to="/datasets">Data</NavLink>
        <NavLink to="/media">Media</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <span className="muted">{user.username}</span>
        <button onClick={() => api('/api/logout', { method: 'POST' }).then(() => location.reload())}>Sign out</button>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/screens" element={<Screens />} />
          <Route path="/screens/:id" element={<Editor />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/media" element={<MediaLibrary />} />
          <Route path="/settings" element={<Settings role={user.role} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Login({ onDone }: { onDone: (user: { username: string; role: string }) => void }) {
  const [error, setError] = useState('')
  return (
    <div className="login">
      <form className="cardish" onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        api<{ username: string; role: string }>('/api/login', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) })
          .then(onDone)
          .catch((reason: Error) => setError(reason.message))
      }}>
        <h1>Sign in</h1>
        <input name="username" placeholder="Username" autoFocus />
        <input name="password" type="password" placeholder="Password" />
        {error ? <p className="warn">{error}</p> : null}
        <button className="primary">Continue</button>
      </form>
    </div>
  )
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  useEffect(() => {
    const load = () => api<DashboardData>('/api/dashboard').then(setData).catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 4000)
    return () => window.clearInterval(timer)
  }, [])
  if (!data) return <p>Loading the floor…</p>
  const freeGb = (data.diskFreeBytes / 1024 / 1024 / 1024).toFixed(1)
  return (
    <section>
      <h1>Dashboard</h1>
      <p className={data.clockWarning ? 'warn' : 'muted'}>{data.clockWarning ? 'The Pi clock looks wrong. Set the time before schedules and the lobby clock can be trusted.' : `Pi time ${new Date(data.now).toLocaleString()}`}</p>
      <p className={data.diskFreeBytes < 500 * 1024 * 1024 ? 'warn' : 'muted'}>{freeGb} GB free</p>
      <div className="grid">
        {data.screens.map((screen) => (
          <article className="cardish" key={screen.id}>
            <h2>{screen.name}</h2>
            <p className="muted">{screen.template} · {screen.mode.width}×{screen.mode.height}</p>
            <p>{screen.loadCount} loads</p>
            {screen.players.length === 0 ? <p className="warn">No display has opened this page</p> : screen.players.map((player) => (
              <p key={player.id} className={player.inUse ? 'ok' : 'warn'}>
                {player.device_name}: {player.inUse ? 'in use' : 'quiet'} · {player.current ? 'current' : 'older version'} · {player.resolutionMatches ? 'resolution matches' : `${player.width}×${player.height}`}
              </p>
            ))}
          </article>
        ))}
      </div>
      <h2>Recent publishes</h2>
      <table>
        <tbody>
          {data.publishes.map((item) => <tr key={item.id}><td>{item.username}</td><td>{item.screen_id.slice(0, 8)}</td><td>v{item.version}</td><td>{new Date(item.published_at).toLocaleString()}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function Screens() {
  const [screens, setScreens] = useState<ScreenSummary[]>([])
  const [name, setName] = useState('Lobby')
  const [template, setTemplate] = useState('award')
  const [modeId, setModeId] = useState('1080x1920')
  const navigate = useNavigate()
  const load = () => api<ScreenSummary[]>('/api/screens').then(setScreens)
  useEffect(() => { void load() }, [])
  return (
    <section>
      <h1>Screens</h1>
      <form className="row" onSubmit={(event) => {
        event.preventDefault()
        void api<ScreenSummary>('/api/screens', { method: 'POST', body: JSON.stringify({ name, template, modeId }) }).then((screen) => navigate(`/screens/${screen.id}`))
      }}>
        <input value={name} onChange={(event) => setName(event.target.value)} />
        <select value={template} onChange={(event) => setTemplate(event.target.value)}>
          <option value="award">Award board</option>
          <option value="directory">Card directory</option>
          <option value="slides">Rotating slides</option>
          <option value="playlist">Playlist</option>
        </select>
        <select value={modeId} onChange={(event) => setModeId(event.target.value)}>
          {DISPLAY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
        </select>
        <button className="primary">Create</button>
      </form>
      <div className="grid">
        {screens.map((screen) => (
          <article className="cardish" key={screen.id}>
            <h2>{screen.name}</h2>
            <p className="muted">{screen.template} · {screen.mode.label || `${screen.mode.width}×${screen.mode.height}`} · {screen.loadCount} loads</p>
            <div className="row">
              <button onClick={() => navigate(`/screens/${screen.id}`)}>Edit</button>
              <button onClick={() => void navigator.clipboard.writeText(`${location.origin}/screen/${screen.slug}`)}>Copy URL</button>
              <a href={`/screen/${screen.slug}`} target="_blank" rel="noreferrer">Open</a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function Editor() {
  const { id } = useParams()
  const [screen, setScreen] = useState<EditorScreen | null>(null)
  const [dataset, setDataset] = useState<DatasetDetail | null>(null)
  const [screens, setScreens] = useState<ScreenSummary[]>([])
  const [media, setMedia] = useState<{ id: string; filename: string }[]>([])
  const [message, setMessage] = useState('')
  const load = () => api<EditorScreen>(`/api/screens/${id}`).then(async (next) => {
    setScreen(next)
    if (next.datasetId) {
      const datasets = await api<DatasetDetail[]>('/api/datasets')
      setDataset(datasets.find((item) => item.id === next.datasetId) || null)
    }
    setScreens(await api<ScreenSummary[]>('/api/screens'))
    setMedia(await api('/api/media'))
  })
  useEffect(() => { void load() }, [id])
  useEffect(() => {
    if (!screen) return
    const timer = window.setTimeout(() => {
      void api(`/api/screens/${screen.id}`, { method: 'PUT', body: JSON.stringify({ name: screen.name, draft: screen.draft, presentation: screen.presentation, modeId: screen.mode.id, turn: screen.turn, datasetId: screen.datasetId }) })
        .then(() => {
          if (dataset) return api(`/api/datasets/${dataset.id}`, { method: 'PUT', body: JSON.stringify({ rows: dataset.rows, name: dataset.name, source: dataset.source, sourceUrl: dataset.sourceUrl, intervalSec: dataset.intervalSec }) })
        })
        .then(() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'signage-refresh' }, location.origin))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [screen, dataset])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'signage-edit' || !screen) return
      const draft = structuredClone(screen.draft) as AwardDraft
      if (event.data.path === 'title') draft.title = event.data.value
      if (event.data.path === 'current.name') draft.current.name = event.data.value
      setScreen({ ...screen, draft })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [screen])
  if (!screen) return null
  const presentation = screen.presentation
  const setPresentation = (patch: Partial<Presentation>) => setScreen({ ...screen, presentation: { ...presentation, ...patch } })
  return (
    <section className="editor">
      <div>
        <div className="row">
          <input value={screen.name} onChange={(event) => setScreen({ ...screen, name: event.target.value })} />
          <button className="primary" onClick={() => api(`/api/screens/${screen.id}/publish`, { method: 'POST' }).then(() => setMessage('Published')).then(load)}>Publish</button>
          <button onClick={() => api(`/api/screens/${screen.id}/revert`, { method: 'POST' }).then(load)}>Revert</button>
          <button onClick={() => api(`/api/screens/${screen.id}/move-to-history`, { method: 'POST' }).then(load).catch((error: Error) => setMessage(error.message))}>Move honoree to history</button>
        </div>
        {message ? <p>{message}</p> : null}
        <Preview mode={screen.mode} slug={screen.slug} />
      </div>
      <div className="inspector cardish">
        <label>Display mode
          <select value={screen.mode.id} onChange={(event) => {
            const mode = DISPLAY_MODES.find((item) => item.id === event.target.value) || screen.mode
            setScreen({ ...screen, mode })
          }}>{DISPLAY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select>
        </label>
        <label>Turn
          <select value={screen.turn} onChange={(event) => setScreen({ ...screen, turn: event.target.value as EditorScreen['turn'] })}>
            <option value="none">None</option>
            <option value="counterclockwise">Counterclockwise</option>
            <option value="clockwise">Clockwise</option>
          </select>
        </label>
        <label>Motion
          <select value={presentation.motion} onChange={(event) => setPresentation({ motion: event.target.value as Presentation['motion'] })}>
            <option value="off">Off</option>
            <option value="subtle">Subtle</option>
            <option value="smooth">Smooth</option>
          </select>
        </label>
        <label>Long lists
          <select value={presentation.listOverflow} onChange={(event) => setPresentation({ listOverflow: event.target.value as Presentation['listOverflow'] })}>
            <option value="fit">Fit</option>
            <option value="slow-scroll">Slow scroll</option>
          </select>
        </label>
        <label>Seconds per row
          <input type="number" value={presentation.scrollSecondsPerRow} onChange={(event) => setPresentation({ scrollSecondsPerRow: Number(event.target.value) })} />
        </label>
        <label><input type="checkbox" checked={presentation.showClock} onChange={(event) => setPresentation({ showClock: event.target.checked })} /> Clock</label>
        <label><input type="checkbox" checked={presentation.showWeather} onChange={(event) => setPresentation({ showWeather: event.target.checked })} /> Weather</label>
        <label><input type="checkbox" checked={presentation.progress} onChange={(event) => setPresentation({ progress: event.target.checked })} /> Playlist countdown</label>
        <label><input type="checkbox" checked={presentation.burnIn.logo} onChange={(event) => setPresentation({ burnIn: { ...presentation.burnIn, logo: event.target.checked } })} /> Logo rest</label>
        <label><input type="checkbox" checked={presentation.burnIn.tone} onChange={(event) => setPresentation({ burnIn: { ...presentation.burnIn, tone: event.target.checked } })} /> Tone shift</label>
        <div className="row">
          <button onClick={() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'signage-burn', mode: 'logo' }, location.origin)}>Preview logo rest</button>
          <button onClick={() => document.querySelector('iframe')?.contentWindow?.postMessage({ type: 'signage-burn', mode: 'tone' }, location.origin)}>Preview tone</button>
        </div>
        <DraftFields screen={screen} setScreen={setScreen} dataset={dataset} setDataset={setDataset} screens={screens} media={media} />
      </div>
    </section>
  )
}

function Preview({ mode, slug }: { mode: { width: number; height: number }; slug: string }) {
  const scale = Math.min(720 / mode.width, 640 / mode.height)
  return (
    <div className="preview-frame" style={{ width: mode.width * scale, height: mode.height * scale }}>
      <iframe title="preview" src={`/screen/${slug}?preview=1`} style={{ width: mode.width, height: mode.height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  )
}

function DraftFields({ screen, setScreen, dataset, setDataset, screens, media }: { screen: EditorScreen; setScreen: (screen: EditorScreen) => void; dataset: DatasetDetail | null; setDataset: (dataset: DatasetDetail | null) => void; screens: ScreenSummary[]; media: { id: string }[] }) {
  const draft = screen.draft
  if (screen.template === 'award') {
    const award = draft as AwardDraft
    const setCurrent = (key: keyof AwardDraft['current'], value: string) => setScreen({ ...screen, draft: { ...award, current: { ...award.current, [key]: value } } })
    return (
      <>
        <label>Title <input value={award.title} onChange={(event) => setScreen({ ...screen, draft: { ...award, title: event.target.value } })} /></label>
        <label>Name <input value={award.current.name} onChange={(event) => setCurrent('name', event.target.value)} /></label>
        <label>Badge <input value={award.current.badgeNumber} onChange={(event) => setCurrent('badgeNumber', event.target.value)} /></label>
        <label>Year <input value={award.current.awardYear} onChange={(event) => setCurrent('awardYear', event.target.value)} /></label>
        <label>Rank <input value={award.current.rank} onChange={(event) => setCurrent('rank', event.target.value)} /></label>
        <label>Hire date <input value={award.current.hireDate} onChange={(event) => setCurrent('hireDate', event.target.value)} /></label>
        <label>Years of service <input value={award.current.yearsOfService} onChange={(event) => setCurrent('yearsOfService', event.target.value)} /></label>
        <MediaSelect label="Photo" value={award.current.photoId} media={media} onChange={(photoId) => setScreen({ ...screen, draft: { ...award, current: { ...award.current, photoId } } })} />
        <BrandingFields branding={award.branding} media={media} onChange={(branding) => setScreen({ ...screen, draft: { ...award, branding } })} />
        <RowsEditor title="History" rows={(dataset?.rows || []) as { id: string; name: string; badgeNumber: string; awardYear: string }[]} columns={['name', 'badgeNumber', 'awardYear']} onChange={(rows) => dataset && setDataset({ ...dataset, rows })} />
      </>
    )
  }
  if (screen.template === 'directory') {
    const directory = draft as DirectoryDraft
    return (
      <>
        <label>Title <input value={directory.title} onChange={(event) => setScreen({ ...screen, draft: { ...directory, title: event.target.value } })} /></label>
        <BrandingFields branding={directory.branding} media={media} onChange={(branding) => setScreen({ ...screen, draft: { ...directory, branding } })} />
        <RowsEditor title="Cards" rows={(dataset?.rows || []) as CardItem[]} columns={['name', 'subtitle', 'phone', 'details']} onChange={(rows) => dataset && setDataset({ ...dataset, rows })} />
        <CsvImport datasetId={dataset?.id || ''} onDone={() => api<DatasetDetail[]>('/api/datasets').then((rows) => setDataset(rows.find((item) => item.id === dataset?.id) || dataset))} />
      </>
    )
  }
  if (screen.template === 'slides') {
    const slides = draft as SlidesDraft
    return (
      <>
        <BrandingFields branding={slides.branding} media={media} onChange={(branding) => setScreen({ ...screen, draft: { ...slides, branding } })} />
        <SlideEditor rows={(dataset?.rows || []) as SlideItem[]} onChange={(rows) => dataset && setDataset({ ...dataset, rows })} />
      </>
    )
  }
  const playlist = draft as PlaylistDraft
  const family = screen.mode.family
  const choices = screens.filter((item) => item.id !== screen.id && item.template !== 'playlist' && item.mode.family === family)
  return (
    <>
      <BrandingFields branding={playlist.branding} media={media} onChange={(branding) => setScreen({ ...screen, draft: { ...playlist, branding } })} />
      <PlaylistEditor entries={playlist.entries} choices={choices} onChange={(entries) => setScreen({ ...screen, draft: { ...playlist, entries } })} />
    </>
  )
}

function BrandingFields({ branding, media, onChange }: { branding: AwardDraft['branding']; media: { id: string }[]; onChange: (branding: AwardDraft['branding']) => void }) {
  return (
    <>
      <label>Agency <input value={branding.agencyName} onChange={(event) => onChange({ ...branding, agencyName: event.target.value })} /></label>
      <label>Footer line <input value={branding.sheriffLine} onChange={(event) => onChange({ ...branding, sheriffLine: event.target.value })} /></label>
      <label>Navy <input value={branding.primary} onChange={(event) => onChange({ ...branding, primary: event.target.value })} /></label>
      <label>Gold <input value={branding.accent} onChange={(event) => onChange({ ...branding, accent: event.target.value })} /></label>
      <MediaSelect label="Badge" value={branding.badgeMediaId} media={media} onChange={(badgeMediaId) => onChange({ ...branding, badgeMediaId })} />
      <MediaSelect label="Seal" value={branding.sealMediaId} media={media} onChange={(sealMediaId) => onChange({ ...branding, sealMediaId })} />
    </>
  )
}

function MediaSelect({ label, value, media, onChange }: { label: string; value: string | null; media: { id: string }[]; onChange: (id: string | null) => void }) {
  return <label>{label}<select value={value || ''} onChange={(event) => onChange(event.target.value || null)}><option value="">None</option>{media.map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)}</option>)}</select></label>
}

function RowsEditor({ title, rows, columns, onChange }: { title: string; rows: Record<string, string>[]; columns: string[]; onChange: (rows: Record<string, string>[]) => void }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.map((row, index) => (
        <div className="row" key={row.id || index}>
          {columns.map((column) => <input key={column} value={row[column] || ''} placeholder={column} onChange={(event) => {
            const next = rows.slice()
            next[index] = { ...row, [column]: event.target.value }
            onChange(next)
          }} />)}
          <button onClick={() => onChange(rows.filter((_, item) => item !== index))}>Remove</button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { id: crypto.randomUUID(), ...Object.fromEntries(columns.map((column) => [column, ''])) }])}>Add</button>
    </div>
  )
}

function CsvImport({ datasetId, onDone }: { datasetId: string; onDone: () => void }) {
  const [csv, setCsv] = useState('name,subtitle,phone,details')
  const [replace, setReplace] = useState(false)
  if (!datasetId) return null
  return (
    <label>CSV
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={4} />
      <span className="row"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} /> Replace the whole list</span>
      <button onClick={() => api(`/api/datasets/${datasetId}/import`, { method: 'POST', body: JSON.stringify({ csv, replace }) }).then(onDone)}>Import</button>
    </label>
  )
}

function SlideEditor({ rows, onChange }: { rows: SlideItem[]; onChange: (rows: SlideItem[]) => void }) {
  const move = (index: number, dir: number) => {
    const next = rows.slice()
    const [item] = next.splice(index, 1)
    next.splice(index + dir, 0, item)
    onChange(next)
  }
  return (
    <div>
      {rows.map((row, index) => (
        <div className="cardish" key={row.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const from = Number(event.dataTransfer.getData('text/plain'))
          const next = rows.slice()
          const [item] = next.splice(from, 1)
          next.splice(index, 0, item)
          onChange(next)
        }}>
          <input value={row.title} placeholder="Title" onChange={(event) => patch(rows, index, { title: event.target.value }, onChange)} />
          <RichText value={row.bodyHtml} onChange={(bodyHtml) => patch(rows, index, { bodyHtml }, onChange)} />
          <input value={row.qrUrl} placeholder="QR URL" onChange={(event) => patch(rows, index, { qrUrl: event.target.value }, onChange)} />
          <input value={row.qrLabel} placeholder="QR caption" onChange={(event) => patch(rows, index, { qrLabel: event.target.value }, onChange)} />
          <input type="number" value={row.durationSec} onChange={(event) => patch(rows, index, { durationSec: Number(event.target.value) }, onChange)} />
          <input value={row.startTime} placeholder="Start HH:MM" onChange={(event) => patch(rows, index, { startTime: event.target.value }, onChange)} />
          <input value={row.endTime} placeholder="End HH:MM" onChange={(event) => patch(rows, index, { endTime: event.target.value }, onChange)} />
          <div className="row"><button onClick={() => move(index, -1)}>Up</button><button onClick={() => move(index, 1)}>Down</button><button onClick={() => onChange(rows.filter((_, item) => item !== index))}>Remove</button></div>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { id: crypto.randomUUID(), kind: 'mixed', title: 'Notice', bodyHtml: '<p></p>', qrUrl: '', qrLabel: '', imageId: null, durationSec: 15, days: [], startTime: '', endTime: '' }])}>Add slide</button>
    </div>
  )
}

function patch<T>(rows: T[], index: number, value: Partial<T>, onChange: (rows: T[]) => void) {
  const next = rows.slice()
  next[index] = { ...rows[index], ...value }
  onChange(next)
}

function RichText({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({ extensions: [StarterKit], content: value, onUpdate: ({ editor: current }) => onChange(current.getHTML()) })
  return <EditorContent editor={editor} className="tiptap" />
}

function PlaylistEditor({ entries, choices, onChange }: { entries: PlaylistEntry[]; choices: ScreenSummary[]; onChange: (entries: PlaylistEntry[]) => void }) {
  const [screenId, setScreenId] = useState(choices[0]?.id || '')
  return (
    <div>
      {entries.map((entry, index) => (
        <div className="row" key={entry.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const from = Number(event.dataTransfer.getData('text/plain'))
          const next = entries.slice()
          const [item] = next.splice(from, 1)
          next.splice(index, 0, item)
          onChange(next)
        }}>
          <span>{choices.find((item) => item.id === entry.screenId)?.name || entry.screenId}</span>
          <input type="number" value={entry.durationSec} onChange={(event) => patch(entries, index, { durationSec: Number(event.target.value) }, onChange)} />
          <button onClick={() => onChange(entries.filter((_, item) => item !== index))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <select value={screenId} onChange={(event) => setScreenId(event.target.value)}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button onClick={() => screenId && onChange([...entries, { id: crypto.randomUUID(), screenId, durationSec: 20, days: [], startTime: '', endTime: '' }])}>Add screen</button>
      </div>
    </div>
  )
}

function Datasets() {
  const [rows, setRows] = useState<DatasetDetail[]>([])
  const load = () => api<DatasetDetail[]>('/api/datasets').then(setRows)
  useEffect(() => { void load() }, [])
  return (
    <section>
      <h1>Data</h1>
      {rows.map((dataset) => (
        <article className="cardish" key={dataset.id}>
          <h2>{dataset.name}</h2>
          <p className="muted">{dataset.kind} · {dataset.count} rows · {dataset.source} {dataset.lastError ? `· ${dataset.lastError}` : ''}</p>
          <div className="row">
            <input value={dataset.sourceUrl} placeholder="http://192.168.1.20/cards.json" onChange={(event) => setRows(rows.map((item) => item.id === dataset.id ? { ...item, sourceUrl: event.target.value, source: 'lan-http' } : item))} />
            <button onClick={() => api(`/api/datasets/${dataset.id}`, { method: 'PUT', body: JSON.stringify({ source: 'lan-http', sourceUrl: dataset.sourceUrl }) }).then(() => api(`/api/datasets/${dataset.id}/fetch`, { method: 'POST' })).then(load)}>Pull now</button>
          </div>
          <p className="muted">Used by {dataset.screens.map((screen) => screen.name).join(', ') || 'no screens'}</p>
        </article>
      ))}
    </section>
  )
}

function MediaLibrary() {
  const [rows, setRows] = useState<{ id: string; folder: string }[]>([])
  const [folder, setFolder] = useState('photos')
  const load = () => api<{ id: string; folder: string }[]>('/api/media').then(setRows)
  useEffect(() => { void load() }, [])
  return (
    <section>
      <h1>Media</h1>
      <form className="row" onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        data.set('folder', folder)
        await fetch('/api/media', { method: 'POST', body: data, credentials: 'include' })
        await load()
      }}>
        <select value={folder} onChange={(event) => setFolder(event.target.value)}>
          <option>photos</option><option>seals</option><option>logos</option>
        </select>
        <input name="file" type="file" accept="image/*" />
        <button className="primary">Upload</button>
      </form>
      <div className="grid">
        {rows.map((item) => <article className="cardish" key={item.id}><img src={`/media/${item.id}`} alt="" style={{ width: '100%' }} /><p className="muted">{item.folder}</p><button onClick={() => api(`/api/media/${item.id}`, { method: 'DELETE' }).then(load)}>Delete</button></article>)}
      </div>
    </section>
  )
}

function Settings({ role }: { role: string }) {
  const [agency, setAgency] = useState({ timezone: 'America/Detroit', weatherLat: '', weatherLon: '' })
  const [override, setOverride] = useState({ active: 0, title: '', body: '', screenId: '' })
  const [users, setUsers] = useState<{ id: string; username: string; role: string }[]>([])
  const [password, setPassword] = useState({ current: '', next: '' })
  useEffect(() => {
    void api<typeof agency & { weatherLat: number | null; weatherLon: number | null }>('/api/agency').then((row) => setAgency({ timezone: row.timezone, weatherLat: row.weatherLat?.toString() || '', weatherLon: row.weatherLon?.toString() || '' }))
    void api<typeof override>('/api/override').then(setOverride)
    if (role === 'admin') void api<typeof users>('/api/users').then(setUsers)
  }, [role])
  return (
    <section>
      <h1>Settings</h1>
      <form className="cardish" onSubmit={(event) => { event.preventDefault(); void api('/api/agency', { method: 'PUT', body: JSON.stringify({ timezone: agency.timezone, weatherLat: agency.weatherLat ? Number(agency.weatherLat) : null, weatherLon: agency.weatherLon ? Number(agency.weatherLon) : null }) }) }}>
        <label>Timezone <input value={agency.timezone} onChange={(event) => setAgency({ ...agency, timezone: event.target.value })} /></label>
        <label>Weather latitude <input value={agency.weatherLat} onChange={(event) => setAgency({ ...agency, weatherLat: event.target.value })} /></label>
        <label>Weather longitude <input value={agency.weatherLon} onChange={(event) => setAgency({ ...agency, weatherLon: event.target.value })} /></label>
        <button className="primary">Save place and clock</button>
      </form>
      <form className="cardish" onSubmit={(event) => { event.preventDefault(); void api('/api/override', { method: 'PUT', body: JSON.stringify({ ...override, active: Boolean(override.active) }) }) }}>
        <h2>Priority override</h2>
        <label><input type="checkbox" checked={Boolean(override.active)} onChange={(event) => setOverride({ ...override, active: event.target.checked ? 1 : 0 })} /> Show on playlists now</label>
        <input value={override.title} placeholder="Title" onChange={(event) => setOverride({ ...override, title: event.target.value })} />
        <textarea value={override.body} placeholder="Message" onChange={(event) => setOverride({ ...override, body: event.target.value })} />
        <button className="primary">Save override</button>
      </form>
      <form className="cardish" onSubmit={(event) => { event.preventDefault(); void api('/api/me/password', { method: 'POST', body: JSON.stringify(password) }) }}>
        <h2>Password</h2>
        <input type="password" placeholder="Current" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} />
        <input type="password" placeholder="New" value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} />
        <button>Change password</button>
      </form>
      {role === 'admin' ? (
        <div className="cardish">
          <h2>People</h2>
          {users.map((user) => <p key={user.id}>{user.username} · {user.role} <button onClick={() => api(`/api/users/${user.id}`, { method: 'DELETE' }).then(() => api<typeof users>('/api/users').then(setUsers))}>Remove</button></p>)}
          <UserForm onDone={() => api<typeof users>('/api/users').then(setUsers)} />
          <h2>Backup</h2>
          <div className="row">
            <a href="/api/admin/backup">Download backup</a>
            <form onSubmit={async (event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              await fetch('/api/admin/restore', { method: 'POST', body: data, credentials: 'include' })
              location.reload()
            }}>
              <input name="file" type="file" />
              <button>Restore</button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function UserForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return <form className="row" onSubmit={(event) => { event.preventDefault(); void api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role: 'editor' }) }).then(onDone) }}><input value={username} placeholder="Username" onChange={(event) => setUsername(event.target.value)} /><input value={password} placeholder="Password" onChange={(event) => setPassword(event.target.value)} /><button>Add editor</button></form>
}

interface ScreenSummary { id: string; slug: string; name: string; template: string; mode: { id: string; label?: string; width: number; height: number; family: string }; loadCount: number; version: number }
interface EditorScreen extends ScreenSummary { draft: ScreenDraft; presentation: Presentation; turn: 'none' | 'clockwise' | 'counterclockwise'; datasetId: string | null }
interface DatasetDetail { id: string; name: string; kind: string; rows: unknown[]; count: number; source: string; sourceUrl: string; intervalSec: number; lastError: string | null; screens: { name: string }[] }
interface DashboardData { now: string; clockWarning: boolean; diskFreeBytes: number; screens: (ScreenSummary & { players: { id: string; device_name: string; inUse: boolean; current: boolean; resolutionMatches: boolean; width: number; height: number }[] })[]; publishes: { id: string; username: string; screen_id: string; version: number; published_at: string }[] }
