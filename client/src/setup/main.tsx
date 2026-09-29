import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DISPLAY_MODES, type DisplayMode } from '@shared/modes'
import '../admin/admin.css'

function Setup() {
  const [user, setUser] = useState<{ username: string } | null>(null)
  const [error, setError] = useState('')
  const [screens, setScreens] = useState<{ id: string; name: string; mode: DisplayMode }[]>([])
  const [screenId, setScreenId] = useState('')
  const [deviceName, setDeviceName] = useState('Lobby display')
  const [mode, setMode] = useState<DisplayMode>(DISPLAY_MODES.find((item) => item.id === '1920x1080')!)
  const [turn, setTurn] = useState('counterclockwise')
  const [restartTime, setRestartTime] = useState('03:00')
  const [command, setCommand] = useState('')
  const [windowsUrl, setWindowsUrl] = useState('')
  const [log, setLog] = useState('')
  const platform = /android/i.test(navigator.userAgent) ? 'android' : /win/i.test(navigator.platform) ? 'windows' : 'linux'

  useEffect(() => {
    const width = window.screen.width
    const height = window.screen.height
    void fetch(`/api/setup/suggest?width=${width}&height=${height}`).then((response) => response.json()).then((body) => setMode(body.recommended))
    void fetch('/api/me', { credentials: 'include' }).then(async (response) => {
      if (!response.ok) return
      setUser(await response.json())
      const list = await fetch('/api/screens', { credentials: 'include' }).then((item) => item.json())
      setScreens(list)
      if (list[0]) setScreenId(list[0].id)
    })
  }, [])

  async function enroll() {
    const body = await fetch('/api/admin/enroll', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screenId, deviceName, restartTime, turn }),
    }).then((response) => response.json())
    localStorage.setItem('signage-device-name', deviceName)
    setCommand(body.linux)
    setWindowsUrl(body.windows)
    return body.token as string
  }

  return (
    <main className="setup">
      <h1>Set up this display</h1>
      <p className="muted">This panel is reporting {window.screen.width}×{window.screen.height}. Recommended mode: {mode.label}.</p>
      {!user ? (
        <form className="cardish" onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void fetch('/api/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) })
            .then(async (response) => {
              if (!response.ok) { setError('Those credentials were not recognized'); return }
              setUser(await response.json())
              setScreens(await fetch('/api/screens', { credentials: 'include' }).then((item) => item.json()))
            })
        }}>
          <input name="username" placeholder="Username" />
          <input name="password" type="password" placeholder="Password" />
          {error ? <p className="warn">{error}</p> : null}
          <button className="primary">Sign in</button>
        </form>
      ) : (
        <form className="cardish" onSubmit={(event) => event.preventDefault()}>
          <label>Name this device <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
          <label>Screen
            <select value={screenId} onChange={(event) => setScreenId(event.target.value)}>
              {screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
            </select>
          </label>
          <label>Display mode
            <select value={mode.id} onChange={(event) => setMode(DISPLAY_MODES.find((item) => item.id === event.target.value) || mode)}>
              {DISPLAY_MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>Turn
            <select value={turn} onChange={(event) => setTurn(event.target.value)}>
              <option value="none">None</option>
              <option value="counterclockwise">Counterclockwise</option>
              <option value="clockwise">Clockwise</option>
            </select>
          </label>
          <label>Nightly browser restart <input value={restartTime} onChange={(event) => setRestartTime(event.target.value)} /></label>
          {platform === 'android' ? (
            <p>This browser cannot install a kiosk script on Android TV. Open the screen URL in a kiosk browser and leave that browser pinned. Trust the certificate from <a href="/setup/ca.crt">the local authority</a> if the page warns you.</p>
          ) : null}
          <div className="row">
            <button className="primary" onClick={async () => {
              const token = await enroll()
              if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
                const result = await fetch('/api/admin/kiosk/install', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).then((response) => response.json())
                setLog(result.log || result.error || `Exit ${result.code}`)
              }
            }}>Install on this machine</button>
            <button onClick={() => void enroll()}>Create install command</button>
            <a href="/setup/ca.crt">Download certificate</a>
          </div>
          {command ? <p>On a Raspberry Pi or Linux PC, run:<br /><code>{command}</code></p> : null}
          {windowsUrl ? <p>On Windows, download and run <a href={windowsUrl}>the PowerShell installer</a>.</p> : null}
          {log ? <pre>{log}</pre> : null}
        </form>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Setup />)
