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

function login() {
  root.innerHTML = `<main class="setup"><form class="cardish"><h1>Set up this display</h1><p>Sign in with an administrator account. The password is not written into the kiosk script.</p><label>Username <input name="username" value="admin"></label><label>Password <input name="password" type="password"></label><button class="primary">Continue</button><p class="warn" id="err"></p></form></main>`
  root.querySelector('form').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    try { me = await api('/api/login', { method: 'POST', body: JSON.stringify(data) }); page() }
    catch (error) { root.querySelector('#err').textContent = error.message }
  }
}

async function page() {
  if (me.role !== 'admin') {
    root.innerHTML = '<main class="setup"><p>An administrator has to enroll this display.</p></main>'
    return
  }
  const suggested = await api(`/api/setup/suggest?width=${screen.width}&height=${screen.height}`)
  const [modes, screens] = await Promise.all([api('/api/modes'), api('/api/screens')])
  const android = /Android/i.test(navigator.userAgent)
  const windows = /Windows/i.test(navigator.userAgent)
  root.innerHTML = `<main class="setup"><h1>Set up this display</h1>
    <p>This panel reports ${screen.width}×${screen.height}. Closest catalog mode: <strong>${suggested.label}</strong>.</p>
    <form id="enroll" class="cardish">
      <label>Device name <input name="deviceName" value="${escapeHtml(deviceName)}" required></label>
      <label>Screen <select name="screenId">${screens.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${item.mode.width}×${item.mode.height}</option>`).join('')}</select></label>
      <label>Mode <select name="modeId">${modes.map((mode) => `<option value="${mode.id}" ${mode.id === suggested.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}</select></label>
      <label>Turn <select name="turn"><option value="counterclockwise">counterclockwise</option><option value="clockwise">clockwise</option><option value="none">none</option></select></label>
      <label>Nightly restart <input name="restartTime" value="03:00"></label>
      <button class="primary">Create setup link</button>
    </form>
    <div id="result"></div>
    <p><a href="/setup/ca.crt">Download the local certificate</a> and trust it once on office PCs.</p>
  </main>`
  document.querySelector('#enroll').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    localStorage.setItem('signage-device-name', data.deviceName)
    const chosen = modes.find((mode) => mode.id === data.modeId)
    if (chosen) await api(`/api/screens/${data.screenId}`, { method: 'PUT', body: JSON.stringify({ mode: chosen, turn: data.turn }) })
    const { token } = await api('/api/admin/enroll', { method: 'POST', body: JSON.stringify(data) })
    const origin = location.origin
    const result = document.querySelector('#result')
    if (android) {
      const screenRow = screens.find((item) => item.id === data.screenId)
      result.innerHTML = `<div class="cardish"><h2>Android TV</h2><p>A browser on this TV cannot install the kiosk for you. Open a kiosk browser and pin it to:</p><p><code>${origin}/screen/${screenRow?.slug || ''}</code></p><p>Turn off sleep in the TV settings. Name this display “${escapeHtml(data.deviceName)}” so the dashboard can see it.</p></div>`
      return
    }
    if (windows) {
      result.innerHTML = `<div class="cardish"><h2>Windows</h2><p>Run this in PowerShell as Administrator. It trusts the local certificate, turns off the screensaver, and opens Chrome or Edge in kiosk mode. It also restarts that browser at ${escapeHtml(data.restartTime)}.</p><p><a href="/setup/install.ps1?token=${token}">Download install.ps1</a></p></div>`
      return
    }
    const command = `curl -fsSL '${origin}/setup/install.sh?token=${token}' | bash`
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    result.innerHTML = local
      ? `<div class="cardish"><h2>This machine</h2><p>Install the kiosk here. The link is used once.</p><button id="run" type="button">Install on this machine</button><pre id="log"></pre><p>Leave kiosk mode with Ctrl+Alt+F2, then <code>systemctl --user stop agency-signage-kiosk.service</code>.</p></div>`
      : `<div class="cardish"><h2>Raspberry Pi or Linux</h2><p>This command installs Chromium, trusts the local certificate, turns off screen blanking, sets the panel mode, and restarts the browser at ${escapeHtml(data.restartTime)}. It does not contain the admin password. The link works once and expires in 30 minutes.</p><pre>${escapeHtml(command)}</pre><p>Leave kiosk mode with Ctrl+Alt+F2, then <code>systemctl --user stop agency-signage-kiosk.service</code>.</p></div>`
    const run = document.querySelector('#run')
    if (run) run.onclick = async () => {
      const response = await fetch('/api/admin/kiosk/install', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      const body = await response.json()
      document.querySelector('#log').textContent = body.output || body.error || (body.ok ? 'Installed' : 'Install failed')
    }
  }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
