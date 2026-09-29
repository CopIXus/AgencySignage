const root = document.querySelector('#root')
const api = (url, options = {}) => fetch(url, {
  credentials: 'same-origin',
  headers: options.body ? { 'content-type': 'application/json' } : {},
  ...options,
}).then(async (response) => {
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body
})

const deviceName = localStorage.getItem('signage-device-name') || ''
let me = await api('/api/me').catch(() => null)
if (!me) login()
else page()

const wrap = (inner) => `<div class="top-bar"></div><div class="login-wrap"><div class="login-card" style="width:min(680px,100%)">${inner}</div></div>`

function login() {
  root.innerHTML = wrap(`<form><h1 class="header-title">Set up this display</h1><p class="header-subtitle" style="margin-bottom:16px">Sign in with an administrator account. The password is not written into the kiosk script.</p><label class="form-field"><span>Username</span><input name="username" value="admin"></label><label class="form-field"><span>Password</span><input name="password" type="password"></label><button class="btn btn-primary btn-block">Continue</button><p class="alert alert-danger" id="err" hidden style="margin-top:12px"></p></form>`)
  root.querySelector('form').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    try { me = await api('/api/login', { method: 'POST', body: JSON.stringify(data) }); page() }
    catch (error) { const err = root.querySelector('#err'); err.hidden = false; err.textContent = error.message }
  }
}

async function page() {
  if (me.role !== 'admin') {
    root.innerHTML = wrap('<div class="alert alert-warn">An administrator has to enroll this display.</div>')
    return
  }
  const suggested = await api(`/api/setup/suggest?width=${screen.width}&height=${screen.height}`)
  const [modes, screens] = await Promise.all([api('/api/modes'), api('/api/screens')])
  const android = /Android/i.test(navigator.userAgent)
  const windows = /Windows/i.test(navigator.userAgent)
  root.innerHTML = wrap(`<h1 class="header-title">Set up this display</h1>
    <p class="header-subtitle" style="margin-bottom:16px">This panel reports <span class="mono">${screen.width}×${screen.height}</span>. Closest catalog mode: <strong>${escapeHtml(suggested.label)}</strong>.</p>
    <form id="enroll" class="stack">
      <div class="form-grid">
        <label class="form-field"><span>Device name</span><input name="deviceName" value="${escapeHtml(deviceName)}" placeholder="Lobby TV" required></label>
        <label class="form-field"><span>Screen to show</span><select name="screenId">${screens.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${item.mode.width}×${item.mode.height}</option>`).join('')}</select></label>
        <label class="form-field"><span>Display mode</span><select name="modeId">${modes.map((mode) => `<option value="${mode.id}" ${mode.id === suggested.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}</select></label>
        <label class="form-field"><span>Turn if mounted the other way</span><select name="turn"><option value="counterclockwise">counterclockwise</option><option value="clockwise">clockwise</option><option value="none">none</option></select></label>
        <label class="form-field"><span>Nightly browser restart</span><input name="restartTime" value="03:00"></label>
      </div>
      <button class="btn btn-primary">Create setup link</button>
    </form>
    <div id="result" style="margin-top:16px"></div>
    <p class="hint" style="margin-top:16px"><a href="/setup/ca.crt">Download the local certificate</a> and trust it once on office PCs. <a href="/admin">Back to admin</a>.</p>`)
  document.querySelector('#enroll').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    localStorage.setItem('signage-device-name', data.deviceName)
    const chosen = modes.find((mode) => mode.id === data.modeId)
    if (chosen) await api(`/api/screens/${data.screenId}`, { method: 'PUT', body: JSON.stringify({ mode: chosen, turn: data.turn }) })
    const { token } = await api('/api/admin/enroll', { method: 'POST', body: JSON.stringify(data) })
    const origin = location.origin
    const result = document.querySelector('#result')
    const screenRow = screens.find((item) => item.id === data.screenId)
    if (android) {
      result.innerHTML = `<div class="form-panel"><h2>Android TV</h2><p>A browser on this TV cannot install the kiosk for you. Open a kiosk browser and pin it to:</p><pre class="code">${origin}/screen/${screenRow?.slug || ''}</pre><p class="hint">Turn off sleep in the TV settings. Name this display “${escapeHtml(data.deviceName)}” so the dashboard can see it.</p></div>`
    } else if (windows) {
      result.innerHTML = `<div class="form-panel"><h2>Windows</h2><p>Run this in PowerShell as Administrator. It trusts the local certificate, turns off the screensaver, and opens Chrome or Edge in kiosk mode. It also restarts that browser at ${escapeHtml(data.restartTime)}.</p><a class="btn btn-primary" href="/setup/install.ps1?token=${token}">Download install.ps1</a></div>`
    } else {
      const command = `curl -fsSL '${origin}/setup/install.sh?token=${token}' | bash`
      const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      result.innerHTML = local
        ? `<div class="form-panel"><h2>This machine</h2><p>Install the kiosk here. The link is used once.</p><button class="btn btn-primary" id="run" type="button">Install on this machine</button><pre class="code" id="log"></pre><p class="hint">Leave kiosk mode with Ctrl+Alt+F2, then <code>systemctl --user stop agency-signage-kiosk.service</code>.</p></div>`
        : `<div class="form-panel"><h2>Raspberry Pi or Linux</h2><p>This command installs Chromium, trusts the local certificate, turns off screen blanking, sets the panel mode, and restarts the browser at ${escapeHtml(data.restartTime)}. It does not contain the admin password. The link works once and expires in 30 minutes.</p><pre class="code">${escapeHtml(command)}</pre><p class="hint">Leave kiosk mode with Ctrl+Alt+F2, then <code>systemctl --user stop agency-signage-kiosk.service</code>.</p></div>`
      const run = document.querySelector('#run')
      if (run) run.onclick = async () => {
        const response = await fetch('/api/admin/kiosk/install', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
        const body = await response.json()
        document.querySelector('#log').textContent = body.output || body.error || (body.ok ? 'Installed' : 'Install failed')
      }
    }
    result.insertAdjacentHTML('beforeend', '<p id="enroll-status" class="alert alert-info">Waiting for this display to open the screen.</p>')
    watchPlayer(data, chosen)
  }
}

let enrollTimer = 0
function watchPlayer(data, chosen) {
  clearInterval(enrollTimer)
  enrollTimer = setInterval(async () => {
    const status = document.querySelector('#enroll-status')
    if (!status) return clearInterval(enrollTimer)
    const dash = await api('/api/dashboard').catch(() => null)
    const screen = dash?.screens.find((item) => item.id === data.screenId)
    const player = screen?.players?.find((item) => item.deviceName === data.deviceName)
    if (!player) return
    const match = chosen && player.width === chosen.width && player.height === chosen.height
    status.className = 'alert alert-ok'
    status.textContent = `${data.deviceName} is enrolled at ${player.width}×${player.height}. ${match ? 'That matches the requested mode.' : 'The reported size differs from the requested mode.'}`
  }, 2000)
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
