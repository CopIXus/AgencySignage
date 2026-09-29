/* Agency Signage admin — vanilla JS, no build step. Hash-routed single page. */
const root = document.querySelector('#root')
let me = null
let agency = { name: 'Agency Signage', logoMediaId: null, theme: 'dark' }
let timer = 0
const VERSION = 'v1.1'

const api = (url, options = {}) => fetch(url, {
  credentials: 'same-origin',
  headers: options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {},
  ...options,
}).then(async (response) => {
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body
})

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  screens: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  media: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  datasets: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  setup: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="12" rx="2"/><path d="M12 8v6M9 11h6M8 21h8"/></svg>',
  ai: '<svg viewBox="0 0 24 24"><path d="M12 3v3M5 8l2 2M19 8l-2 2"/><rect x="5" y="10" width="14" height="10" rx="3"/><circle cx="9.5" cy="15" r="1"/><circle cx="14.5" cy="15" r="1"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h0"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
}

boot()

async function boot() {
  agency = await api('/api/public/agency').catch(() => agency)
  applyTheme()
  me = await api('/api/me').catch(() => null)
  render()
  window.addEventListener('hashchange', render)
}
function applyTheme() {
  document.documentElement.dataset.theme = localStorage.getItem('signage-theme') || agency.theme || 'dark'
}

function render() {
  clearInterval(timer)
  closeModal()
  if (!me) return login()
  const path = location.hash.replace(/^#/, '') || '/'
  const screenId = /^\/screens\/([^/]+)$/.exec(path)?.[1]
  if (screenId) return editor(screenId).catch(fail)
  if (path === '/screens') return screensPage().catch(fail)
  if (path.startsWith('/datasets')) return datasets().catch(fail)
  if (path.startsWith('/media')) return media().catch(fail)
  if (path.startsWith('/settings')) return settings().catch(fail)
  if (path.startsWith('/ai')) return aiPage().catch(fail)
  if (path.startsWith('/help')) return helpPage()
  return dashboard().catch(fail)
}
function fail(error) {
  if (/Sign in required/.test(error.message)) { me = null; return login() }
  toast(error.message, 'err')
}

/* ---------- Shell ---------- */
function shell(active, inner, header = null) {
  const nav = (id, href, label, target = '') => `<a class="nav-item ${active === id ? 'active' : ''}" href="${href}" ${target ? `target="${target}" rel="noopener"` : ''}>${ICONS[id] || ''}<span>${label}</span></a>`
  root.innerHTML = `<div class="top-bar"></div><div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">${logoMark()}<div><strong>${escapeHtml(agency.name)}</strong><small>Signage · ${VERSION}</small></div></div>
      <nav class="nav">
        <div class="nav-section-label">Operate</div>
        ${nav('home', '#/', 'Dashboard')}${nav('screens', '#/screens', 'Screens')}${nav('media', '#/media', 'Media')}${nav('datasets', '#/datasets', 'Datasets')}
        <div class="nav-section-label">Connect</div>
        ${nav('setup', '/setup', 'Add a display', '_blank')}${nav('ai', '#/ai', 'AI access')}
        <div class="nav-section-label">Admin</div>
        ${nav('settings', '#/settings', 'Settings')}${nav('help', '#/help', 'Help')}
      </nav>
      <div class="sidebar-foot"><div class="who"><strong>${escapeHtml(me.username)}</strong><span>${escapeHtml(me.role)}</span></div><div class="row tight"><button class="btn btn-ghost btn-sm" id="theme" type="button" title="Switch light or dark">◐</button><button class="btn btn-ghost btn-sm" id="logout" type="button">Sign out</button></div></div>
    </aside>
    <main class="main">
      ${header ? `<div class="header"><div><button class="btn btn-ghost btn-sm menu-btn" id="menu" type="button">${ICONS.menu}</button>${header.crumbs ? `<div class="crumbs">${header.crumbs}</div>` : ''}<h1 class="header-title">${header.title}</h1>${header.subtitle ? `<div class="header-subtitle">${header.subtitle}</div>` : ''}</div><div class="header-actions">${header.actions || ''}</div></div>` : ''}
      ${inner}
    </main>
  </div><div class="toast-wrap" id="toasts"></div>`
  document.querySelector('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); me = null; render() }
  document.querySelector('#theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('signage-theme', next)
    applyTheme()
  }
  document.querySelector('#menu')?.addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'))
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => document.querySelector('#sidebar').classList.remove('open')))
}
function logoMark() {
  return agency.logoMediaId ? `<img src="/media/${escapeHtml(agency.logoMediaId)}" alt="">` : '<div class="logo-mark">AS</div>'
}
function toast(message, kind = '') {
  const wrap = document.querySelector('#toasts') || (() => { const div = document.createElement('div'); div.className = 'toast-wrap'; div.id = 'toasts'; document.body.appendChild(div); return div })()
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  wrap.appendChild(node)
  setTimeout(() => node.remove(), 3800)
}
function openModal(html) {
  closeModal()
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal'
  overlay.innerHTML = `<div class="modal">${html}</div>`
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal() })
  document.body.appendChild(overlay)
  return overlay
}
function closeModal() { document.querySelector('#modal')?.remove() }

/* ---------- Login ---------- */
function login() {
  root.innerHTML = `<div class="top-bar"></div><div class="login-wrap"><form class="login-card">
    <div class="sidebar-logo">${logoMark()}<div><strong>${escapeHtml(agency.name)}</strong><small>Signage admin</small></div></div>
    <label class="form-field"><span>Username</span><input name="username" autocomplete="username" autofocus></label>
    <label class="form-field"><span>Password</span><input name="password" type="password" autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    <p class="alert alert-danger" id="err" hidden style="margin-top:12px"></p>
    <p class="hint" style="margin-top:14px">Lost the admin password? On the Pi run <code>node server/reset-password.js admin</code>.</p>
  </form></div><div class="toast-wrap" id="toasts"></div>`
  root.querySelector('form').onsubmit = async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      me = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) })
      render()
    } catch (error) { const err = root.querySelector('#err'); err.hidden = false; err.textContent = error.message }
  }
}

/* ---------- Dashboard ---------- */
async function dashboard() {
  let known = ''
  const draw = async () => {
    const dash = await api('/api/dashboard')
    const online = dash.players.filter((player) => player.inUse)
    const gb = (dash.diskFreeBytes / 1024 ** 3).toFixed(1)
    const unpublished = dash.screens.filter((screen) => screen.version === 0).length
    const live = `
      ${dash.clockWarning ? '<div class="alert alert-warn">The Pi clock looks wrong. Set the time before relying on day and time windows.</div>' : ''}
      ${dash.diskFreeBytes < 500 * 1024 * 1024 ? '<div class="alert alert-danger">Less than 500 MB is free on the Pi. Uploads are paused until space is freed.</div>' : ''}
      <div class="metrics-bar">
        <div class="metric-card"><div class="metric-label">Screens</div><div class="metric-value">${dash.screens.length}</div><div class="metric-detail">${unpublished ? `${unpublished} not published yet` : 'all published'}</div></div>
        <div class="metric-card"><div class="metric-label">Displays online</div><div class="metric-value ${online.length ? 'ok' : ''}">${online.length}</div><div class="metric-detail">${dash.players.length} known display${dash.players.length === 1 ? '' : 's'}</div></div>
        <div class="metric-card"><div class="metric-label">Free disk</div><div class="metric-value ${dash.diskFreeBytes < 2 * 1024 ** 3 ? 'warn' : ''}">${gb} GB</div><div class="metric-detail">nightly backup in data/backups</div></div>
        <div class="metric-card"><div class="metric-label">Server time</div><div class="metric-value ${dash.clockWarning ? 'bad' : ''}" style="font-size:18px">${new Intl.DateTimeFormat('en-US', { timeZone: dash.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(dash.serverNow))}</div><div class="metric-detail">${escapeHtml(dash.timezone)}</div></div>
      </div>
      <div class="section-title"><span>Displays</span><a class="btn btn-sm" href="/setup" target="_blank" rel="noopener">Add a display</a></div>
      ${dash.players.length ? `<div class="table-wrap form-panel" style="padding:0"><table class="table"><thead><tr><th>Device</th><th>Screen</th><th>Status</th><th>Version</th><th>Resolution</th><th>Last seen</th></tr></thead><tbody>${dash.players.map((player) => {
        const screen = dash.screens.find((item) => item.slug === player.screenSlug)
        const matches = screen && player.width === screen.mode.width && player.height === screen.mode.height
        const rotated = screen && player.width === screen.mode.height && player.height === screen.mode.width
        return `<tr><td>${escapeHtml(player.deviceName)}</td><td>${screen ? `<a href="#/screens/${screen.id}">${escapeHtml(screen.name)}</a>` : escapeHtml(player.screenSlug)}</td><td><span class="status-pill ${player.inUse ? 'status-running' : 'status-idle'}">${player.inUse ? 'online' : 'idle'}</span></td><td class="mono">${player.reportedVersion ?? '—'}${screen && player.reportedVersion !== null && player.reportedVersion !== screen.version ? ` <span class="status-pill status-warn">behind v${screen.version}</span>` : ''}</td><td class="mono">${player.width}×${player.height}${matches ? '' : rotated ? ' <span class="status-pill status-info">turned</span>' : ' <span class="status-pill status-warn">differs</span>'}</td><td class="card-meta">${ago(player.lastSeen)}</td></tr>`
      }).join('')}</tbody></table></div>` : '<div class="empty-state">No display has opened a screen yet. Use <a href="/setup" target="_blank" rel="noopener">Add a display</a> to enroll a Pi, Windows, Linux, or Android TV device.</div>'}
      <div class="section-title"><span>Recent publishes</span></div>
      ${dash.publishes.length ? `<div class="form-panel" style="padding:0"><table class="table"><tbody>${dash.publishes.map((item) => `<tr><td>${escapeHtml(dash.screens.find((screen) => screen.id === item.screen_id)?.name || 'Screen')}</td><td class="mono">v${item.version}</td><td>${escapeHtml(item.username)}</td><td class="card-meta">${ago(item.published_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nothing published yet.</p>'}`
    const key = dash.screens.map((screen) => `${screen.id}:${screen.version}:${screen.mode.width}x${screen.mode.height}`).join('|')
    if (!document.querySelector('#dash-live') || key !== known) {
      known = key
      shell('home', `<div id="dash-live">${live}</div>
        <div class="section-title"><span>Screens</span><a class="btn btn-sm" href="#/screens">Manage screens</a></div>
        <div class="cards-grid">${dash.screens.map((screen) => screenCard(screen, dash.players)).join('') || '<div class="empty-state">No screens yet. <a href="#/screens">Create one</a>.</div>'}</div>`,
      { title: 'Dashboard', subtitle: `${escapeHtml(agency.name)} · local signage server at ${escapeHtml(location.host)}` })
      mountThumbs()
      bindCopy()
    } else {
      document.querySelector('#dash-live').innerHTML = live
    }
  }
  await draw()
  timer = setInterval(() => draw().catch(() => {}), 5000)
}
function screenCard(screen, players = [], extra = '') {
  const mine = players.filter((player) => player.screenSlug === screen.slug)
  const online = mine.filter((player) => player.inUse).length
  return `<article class="card">
    <div class="thumb" data-slug="${escapeAttr(screen.slug)}" data-w="${screen.mode.width}" data-h="${screen.mode.height}"><span class="thumb-tag status-pill ${screen.version ? 'status-running' : 'status-warn'}">${screen.version ? `v${screen.version}` : 'draft only'}</span><a class="thumb-open" href="#/screens/${screen.id}" aria-label="Edit ${escapeAttr(screen.name)}"></a></div>
    <div class="card-title"><a href="#/screens/${screen.id}">${escapeHtml(screen.name)}</a><span class="badge">${escapeHtml(templateLabel(screen.template))}</span></div>
    <div class="card-desc">${screen.mode.width}×${screen.mode.height} · ${escapeHtml(screen.mode.family || '')} · <span class="mono">/screen/${escapeHtml(screen.slug)}</span></div>
    <div class="card-foot">
      <span class="status-pill ${online ? 'status-running' : mine.length ? 'status-idle' : 'status-idle'}">${online ? `${online} online` : mine.length ? `${mine.length} idle` : 'no display yet'}</span>
      <span class="card-meta">loaded ${screen.loadCount}×</span>
      ${extra}
    </div>
  </article>`
}
function templateLabel(template) {
  return { award: 'Award board', directory: 'Directory', slides: 'Slides', playlist: 'Playlist' }[template] || template
}
function mountThumbs(scope = document) {
  scope.querySelectorAll('.thumb[data-slug]:not([data-mounted])').forEach((box) => {
    box.dataset.mounted = '1'
    const w = Number(box.dataset.w) || 1920
    const h = Number(box.dataset.h) || 1080
    const frame = document.createElement('iframe')
    frame.title = 'Screen preview'
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    frame.src = `/screen/${box.dataset.slug}?preview=1&thumb=1`
    frame.style.width = `${w}px`
    frame.style.height = `${h}px`
    const fit = () => { const scale = Math.min(box.clientWidth / w, box.clientHeight / h); frame.style.transform = `translate(-50%, -50%) scale(${scale})` }
    box.prepend(frame)
    fit()
    new ResizeObserver(fit).observe(box)
  })
}
function bindCopy(scope = document) {
  scope.querySelectorAll('[data-copy]').forEach((button) => {
    button.onclick = async () => { await navigator.clipboard.writeText(button.dataset.copy); toast('Copied to the clipboard', 'ok') }
  })
}
function ago(iso) {
  if (!iso) return '—'
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

/* ---------- Screens ---------- */
async function screensPage() {
  const [screens, modes, dash] = await Promise.all([api('/api/screens'), api('/api/modes'), api('/api/dashboard')])
  shell('screens', `<div class="cards-grid">${screens.map((screen) => screenCard(screen, dash.players, `<span style="flex:1"></span><button class="btn btn-sm" type="button" data-copy="${location.origin}/screen/${escapeAttr(screen.slug)}">Copy URL</button><a class="btn btn-sm" href="/screen/${escapeAttr(screen.slug)}?preview=1" target="_blank" rel="noopener">Open</a><button class="btn btn-sm btn-danger" type="button" data-delete="${screen.id}" data-name="${escapeAttr(screen.name)}">Delete</button>`)).join('') || '<div class="empty-state">No screens yet. Create the first one.</div>'}</div>`,
  { title: 'Screens', subtitle: 'Each screen is one page a display opens. Edit it live, then publish when it looks right.', actions: '<button class="btn btn-primary" id="new" type="button">New screen</button>' })
  mountThumbs()
  bindCopy()
  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm(`Delete "${button.dataset.name}"? Displays showing it will keep their last copy until they are pointed elsewhere.`)) return
      await api(`/api/screens/${button.dataset.delete}`, { method: 'DELETE' })
      toast('Screen deleted', 'ok')
      screensPage()
    }
  })
  document.querySelector('#new').onclick = () => {
    const overlay = openModal(`<h2>New screen</h2><form id="create" class="stack">
      <label class="form-field"><span>Name</span><input name="name" placeholder="Lobby award board" required autofocus></label>
      <div class="form-grid">
        <label class="form-field"><span>Template</span><select name="template">${['award', 'directory', 'slides', 'playlist'].map((template) => `<option value="${template}">${templateLabel(template)}</option>`).join('')}</select></label>
        <label class="form-field"><span>Display mode</span><select name="modeId">${modes.map((mode) => `<option value="${mode.id}" ${mode.id === 'fhd-portrait' ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}</select></label>
      </div>
      <p class="hint" id="tpl-help"></p>
      <div class="row" style="justify-content:flex-end"><button class="btn" type="button" id="cancel">Cancel</button><button class="btn btn-primary" type="submit">Create and open</button></div>
    </form>`)
    const help = { award: 'Current honoree with photo, badge, and a wall of previous recipients.', directory: 'Alphabetical cards with logo, phone, address, hours, and notes. CSV import supported.', slides: 'Rotating announcements with text, a photo, and a QR code, scheduled by day and time.', playlist: 'Rotates through other screens of the same shape on a timer.' }
    const form = overlay.querySelector('#create')
    const showHelp = () => { overlay.querySelector('#tpl-help').textContent = help[form.template.value] }
    showHelp()
    form.template.onchange = showHelp
    overlay.querySelector('#cancel').onclick = closeModal
    form.onsubmit = async (event) => {
      event.preventDefault()
      const screen = await api('/api/screens', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) })
      closeModal()
      location.hash = `#/screens/${screen.id}`
    }
  }
}

/* ---------- Editor ---------- */
async function editor(id) {
  const [screen, datasets, modes, mediaItems, allScreens] = await Promise.all([api(`/api/screens/${id}`), api('/api/datasets'), api('/api/modes'), api('/api/media'), api('/api/screens')])
  const dataset = datasets.find((item) => item.id === screen.datasetId)
  const state = { screen, dataset, modes, mediaItems, allScreens, tab: sessionStorage.getItem(`tab:${id}`) || 'content', selected: '' }
  shell('screens', `<div class="editor">
      <div class="preview-pane">
        <div class="preview-frame" id="pane"><iframe id="preview" title="Live preview"></iframe></div>
        <div class="preview-bar"><span id="preview-meta"></span><span class="row tight"><button class="btn btn-sm" type="button" data-copy="${location.origin}/screen/${escapeAttr(screen.slug)}">Copy display URL</button><a class="btn btn-sm" href="/screen/${escapeAttr(screen.slug)}?preview=1" target="_blank" rel="noopener">Open draft full size</a></span></div>
        <div class="help-card" id="edit-hint">Click headings and names in the preview to edit them in place. In <strong>Layout</strong> mode, drag panels to move them and pull the corner to resize.</div>
      </div>
      <form class="inspector" id="form"></form>
    </div>`,
  { crumbs: '<a href="#/screens">Screens</a> / edit', title: escapeHtml(screen.name), subtitle: `${templateLabel(screen.template)} · <span class="mono">/screen/${escapeHtml(screen.slug)}</span>`, actions: '<span id="pub-state"></span><button class="btn" type="button" id="revert">Revert draft</button><button class="btn btn-primary" type="button" id="publish">Publish</button>' })
  bindCopy()
  const form = document.querySelector('#form')
  form.onsubmit = (event) => event.preventDefault()
  drawForm(form, state)
  const frame = document.querySelector('#preview')
  frame.src = `/screen/${screen.slug}?preview=1`
  fitPreview()
  window.addEventListener('resize', fitPreview)
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data?.type) return
    if (event.data.type === 'signage-edit') {
      setPath(state.screen.draft, event.data.path, event.data.value)
      drawForm(form, state)
      queueSave(state)
    }
    if (event.data.type === 'signage-layout') {
      const section = (state.screen.draft.layout?.sections || []).find((item) => item.id === event.data.id)
      if (!section) return
      Object.assign(section, { x: event.data.x, y: event.data.y, w: event.data.w, h: event.data.h })
      const node = form.querySelector(`.section-item[data-sid="${event.data.id}"]`)
      if (node) for (const key of ['x', 'y', 'w', 'h']) { const input = node.querySelector(`[data-sf="${key}"]`); if (input) input.value = section[key] }
      queueSave(state, true)
    }
    if (event.data.type === 'signage-select') {
      state.selected = event.data.id
      state.tab = 'layout'
      drawForm(form, state)
      form.querySelector(`.section-item[data-sid="${event.data.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
  form.addEventListener('input', () => { readForm(form, state); queueSave(state) })
  form.addEventListener('change', () => { readForm(form, state); queueSave(state) })
  const publish = async () => { state.screen = await api(`/api/screens/${id}/publish`, { method: 'POST', body: '{}' }); toast(`Published version ${state.screen.version}`, 'ok'); drawForm(form, state) }
  const revert = async () => {
    if (!confirm('Throw away unpublished changes and go back to the published version?')) return
    state.screen = await api(`/api/screens/${id}/revert`, { method: 'POST', body: '{}' })
    if (state.dataset) state.dataset = (await api('/api/datasets')).find((item) => item.id === state.dataset.id)
    toast('Draft reverted', 'ok')
    drawForm(form, state)
    frame.contentWindow?.postMessage({ type: 'signage-refresh' }, location.origin)
  }
  document.querySelector('#publish').onclick = () => publish().catch(fail)
  document.querySelector('#revert').onclick = () => revert().catch(fail)
  form.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]')
    if (!button) return
    const action = button.dataset.action
    event.preventDefault()
    const layout = state.screen.draft.layout
    let save = true
    try {
      if (action === 'tab') { state.tab = button.dataset.tab; sessionStorage.setItem(`tab:${id}`, state.tab); save = false }
      if (action === 'history') { state.screen = await api(`/api/screens/${id}/move-to-history`, { method: 'POST', body: '{}' }); state.dataset = (await api('/api/datasets')).find((item) => item.id === state.dataset?.id); toast('Moved to previous recipients', 'ok'); save = false }
      if (action === 'burn-logo' || action === 'burn-tone') { frame.contentWindow?.postMessage({ type: 'signage-burn', mode: action === 'burn-logo' ? 'logo' : 'tone' }, location.origin); save = false }
      if (action === 'add-row') addRow(state)
      if (action === 'remove-row') state.dataset.rows.splice(Number(button.dataset.index), 1)
      if (action === 'add-slide') addSlide(state)
      if (action === 'remove-slide') state.dataset.rows.splice(Number(button.dataset.index), 1)
      if (action === 'add-entry') addEntry(state)
      if (action === 'remove-entry') state.screen.draft.entries.splice(Number(button.dataset.index), 1)
      if (action === 'import' && state.dataset) {
        state.dataset = await api(`/api/datasets/${state.dataset.id}/import`, { method: 'POST', body: JSON.stringify({ csv: form.querySelector('[name=csv]')?.value || '', replace: Boolean(form.querySelector('[name=replace]')?.checked) }) })
        toast(`Imported ${state.dataset.rows.length} cards`, 'ok')
        save = false
      }
      if (action === 'add-section') { layout.enabled = true; layout.sections.push(newSection(button.dataset.kind)); state.selected = layout.sections.at(-1).id }
      if (action === 'remove-section') layout.sections = layout.sections.filter((item) => item.id !== button.dataset.sid)
      if (action === 'dup-section') { const source = layout.sections.find((item) => item.id === button.dataset.sid); if (source) layout.sections.push({ ...source, id: sectionId(), x: Math.min(90, source.x + 4), y: Math.min(90, source.y + 4) }) }
      if (action === 'move-section') { const index = layout.sections.findIndex((item) => item.id === button.dataset.sid); const to = index + Number(button.dataset.dir); if (index >= 0 && to >= 0 && to < layout.sections.length) { const [item] = layout.sections.splice(index, 1); layout.sections.splice(to, 0, item) } }
      if (action === 'select-section') { state.selected = state.selected === button.dataset.sid ? '' : button.dataset.sid; save = false }
      if (action === 'preset') applyPreset(state, button.dataset.preset)
      if (action === 'swatch') Object.assign(state.screen.draft.branding, PALETTES[button.dataset.palette].colors)
      if (action === 'pick-media') {
        save = false
        const picked = await pickMedia(state, form.querySelector(`[name="${button.dataset.target}"]`)?.value || '')
        if (picked !== undefined) { const input = form.querySelector(`[name="${button.dataset.target}"]`); if (input) { input.value = picked || ''; readForm(form, state); save = true } }
      }
      if (action === 'clear-media') { const input = form.querySelector(`[name="${button.dataset.target}"]`); if (input) { input.value = ''; readForm(form, state) } }
    } catch (error) { fail(error); return }
    drawForm(form, state)
    if (save) queueSave(state)
  })
}

function fitPreview() {
  const pane = document.querySelector('#pane')
  const frame = document.querySelector('#preview')
  if (!pane || !frame || !frame.dataset.width) return
  const width = Number(frame.dataset.width)
  const height = Number(frame.dataset.height)
  const scale = Math.min(pane.clientWidth / width, Math.max(240, window.innerHeight - 230) / height)
  frame.style.width = `${width}px`
  frame.style.height = `${height}px`
  frame.style.transform = `scale(${scale})`
  frame.style.transformOrigin = 'top left'
  pane.style.height = `${height * scale}px`
  const meta = document.querySelector('#preview-meta')
  if (meta) meta.textContent = `${width}×${height} shown at ${Math.round(scale * 100)}%`
}

const PALETTES = {
  navy: { label: 'Navy & gold', colors: { primary: '#0c2340', accent: '#c4a35a', ink: '#f4efe4', plate: '#f3e6c4', lightBg: '#f6f1e6', lightInk: '#0c2340' } },
  slate: { label: 'Slate & cyan', colors: { primary: '#0f172a', accent: '#06b6d4', ink: '#e2e8f0', plate: '#e2e8f0', lightBg: '#f1f5f9', lightInk: '#0f172a' } },
  forest: { label: 'Forest & brass', colors: { primary: '#14301f', accent: '#c9a24a', ink: '#f3efe2', plate: '#ece4c8', lightBg: '#f4f1e8', lightInk: '#14301f' } },
  maroon: { label: 'Maroon & gold', colors: { primary: '#4a1020', accent: '#d8b45a', ink: '#f6efe8', plate: '#f1e3cf', lightBg: '#f7efe9', lightInk: '#4a1020' } },
  black: { label: 'Black & silver', colors: { primary: '#0b0d10', accent: '#c0c6cf', ink: '#f2f4f7', plate: '#e6e9ee', lightBg: '#f3f4f6', lightInk: '#0b0d10' } },
  royal: { label: 'Royal & white', colors: { primary: '#1e3a8a', accent: '#ffffff', ink: '#f8fafc', plate: '#f8fafc', lightBg: '#eef2ff', lightInk: '#1e3a8a' } },
}
const PRESETS = {
  photo: { label: 'Photo background', mini: [[5, 8, 90, 84]], build: () => [sec('content', { x: 5, y: 8, w: 90, h: 84 })] },
  header: { label: 'Header photo + content', mini: [[5, 4, 90, 26], [5, 34, 90, 62]], build: () => [sec('image', { x: 5, y: 4, w: 90, h: 26, fit: 'cover', fill: 'transparent', radius: 14 }), sec('content', { x: 5, y: 34, w: 90, h: 62 })] },
  side: { label: 'Side logo + content', mini: [[4, 8, 26, 84], [34, 8, 62, 84]], build: () => [sec('image', { x: 4, y: 8, w: 26, h: 84, fill: 'rgba(255,255,255,0.9)', radius: 18, padding: 3 }), sec('content', { x: 34, y: 8, w: 62, h: 84 })] },
  clock: { label: 'Content + clock and notice', mini: [[4, 6, 62, 88], [70, 6, 26, 24], [70, 34, 26, 60]], build: () => [sec('content', { x: 4, y: 6, w: 62, h: 88 }), sec('clock', { x: 70, y: 6, w: 26, h: 24, align: 'center', showDate: true }), sec('text', { x: 70, y: 34, w: 26, h: 60, title: 'Notice', body: 'Write a message for visitors here.' })] },
}
function sec(kind, overrides) { return { ...newSection(kind), ...overrides } }
function sectionId() { return `s${Math.random().toString(36).slice(2, 8)}` }
function newSection(kind) {
  const base = { id: sectionId(), kind, x: 10, y: 10, w: 40, h: 20, fill: 'rgba(12,35,64,0.72)', ink: '', radius: 18, padding: 3, align: 'left', scroll: 'auto', font: 100, border: '', shadow: false }
  if (kind === 'text') return { ...base, title: 'Heading', body: 'Text shown inside this floating panel.' }
  if (kind === 'image') return { ...base, mediaId: null, fit: 'contain', fill: 'transparent', padding: 0 }
  if (kind === 'clock') return { ...base, w: 30, h: 12, showDate: true, align: 'center' }
  if (kind === 'content') return { ...base, x: 5, y: 8, w: 90, h: 84 }
  return base
}
function applyPreset(state, key) {
  const preset = PRESETS[key]
  if (!preset) return
  const layout = state.screen.draft.layout
  layout.enabled = true
  layout.sections = preset.build()
  state.selected = layout.sections[0]?.id || ''
}

function drawForm(form, state) {
  const screen = state.screen
  const draft = screen.draft
  draft.layout = { enabled: false, backgroundMediaId: null, backgroundFit: 'cover', dim: 35, blur: 0, sections: [], ...(draft.layout || {}) }
  if (!draft.branding) draft.branding = {}
  const burn = screen.presentation.burnIn
  const tabs = [['content', 'Content'], ['layout', 'Layout'], ['look', 'Look'], ['display', 'Display'], ['publish', 'Publish']]
  const show = (tab) => (state.tab === tab ? '' : 'hidden')
  const media = state.mediaItems
  form.innerHTML = `<div class="tabs">${tabs.map(([key, label]) => `<button class="tab-btn ${state.tab === key ? 'active' : ''}" type="button" data-action="tab" data-tab="${key}">${label}</button>`).join('')}</div>
    <div ${show('content')}>${templateFields(state)}</div>
    <div ${show('layout')}>${layoutFields(state)}</div>
    <div ${show('look')}>
      <h3>Palette</h3>
      <div class="swatches">${Object.entries(PALETTES).map(([key, palette]) => `<button class="swatch" type="button" title="${palette.label}" data-action="swatch" data-palette="${key}" style="background:linear-gradient(135deg, ${palette.colors.primary} 50%, ${palette.colors.accent} 50%)"></button>`).join('')}</div>
      <div class="form-grid" style="margin-top:10px">
        ${color('primary', 'Background', draft.branding.primary)}${color('accent', 'Accent', draft.branding.accent)}${color('ink', 'Text', draft.branding.ink)}${color('plate', 'Card', draft.branding.plate)}${color('lightBg', 'Tone shift background', draft.branding.lightBg)}${color('lightInk', 'Tone shift text', draft.branding.lightInk)}
        <label class="form-field wide"><span>Type style</span><select name="font">${[['sans', 'Clean sans-serif'], ['serif', 'Classic serif'], ['rounded', 'Rounded'], ['mono', 'Monospace']].map(([key, label]) => `<option value="${key}" ${(draft.branding.font || 'sans') === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      <h3>Agency</h3>
      <div class="form-grid">
        <label class="form-field wide"><span>Agency name</span><input name="agencyName" value="${escapeAttr(draft.branding.agencyName || '')}"></label>
        <label class="form-field wide"><span>Second line (sheriff, chief, division)</span><input name="sheriffLine" value="${escapeAttr(draft.branding.sheriffLine || '')}"></label>
        ${mediaPick('sealMediaId', draft.branding.sealMediaId, media, 'Seal (shown when empty and on logo rest)')}
        ${mediaPick('badgeMediaId', draft.branding.badgeMediaId, media, 'Badge (award board)')}
      </div>
    </div>
    <div ${show('display')}>
      <h3>Screen</h3>
      <div class="form-grid">
        <label class="form-field wide"><span>Name</span><input name="name" value="${escapeAttr(screen.name)}"></label>
        <label class="form-field wide"><span>Display mode</span><select name="modeId">${state.modes.map((mode) => `<option value="${mode.id}" ${mode.id === screen.mode.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}<option value="custom" ${String(screen.mode.id).startsWith('custom-') ? 'selected' : ''}>Custom size</option></select></label>
        <label class="form-field"><span>Custom width</span><input name="customWidth" type="number" min="640" max="4096" value="${screen.mode.width}"></label>
        <label class="form-field"><span>Custom height</span><input name="customHeight" type="number" min="640" max="4096" value="${screen.mode.height}"></label>
        <label class="form-field wide"><span>If the TV is mounted the other way, turn</span><select name="turn">${[['none', 'Do not turn'], ['clockwise', 'Clockwise'], ['counterclockwise', 'Counterclockwise']].map(([key, label]) => `<option value="${key}" ${key === screen.turn ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      <h3>Motion and lists</h3>
      <div class="form-grid">
        <label class="form-field"><span>Motion</span><select name="motion">${['off', 'subtle', 'smooth'].map((motion) => `<option ${motion === screen.presentation.motion ? 'selected' : ''}>${motion}</option>`).join('')}</select></label>
        <label class="form-field"><span>Long lists</span><select name="listOverflow">${[['fit', 'Shrink to fit'], ['slow-scroll', 'Slow scroll']].map(([key, label]) => `<option value="${key}" ${key === screen.presentation.listOverflow ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="form-field"><span>Seconds per row</span><input name="scrollSecondsPerRow" type="number" min="4" value="${screen.presentation.scrollSecondsPerRow}"></label>
      </div>
      <h3>Corner and interaction</h3>
      <div class="stack">
        <label class="check"><input name="showClock" type="checkbox" ${screen.presentation.showClock ? 'checked' : ''}> Show the clock</label>
        <label class="check"><input name="showWeather" type="checkbox" ${screen.presentation.showWeather ? 'checked' : ''}> Show the weather (set coordinates in Settings)</label>
        <label class="check"><input name="progress" type="checkbox" ${screen.presentation.progress ? 'checked' : ''}> Playlist countdown</label>
        <label class="check"><input name="details" type="checkbox" ${screen.presentation.details ? 'checked' : ''}> Tap a card to open details (touch kiosks)</label>
        <label class="form-field"><span>Return to the board after (seconds)</span><input name="detailsSeconds" type="number" min="5" value="${screen.presentation.detailsSeconds || 30}"></label>
      </div>
      <h3>Burn-in protection</h3>
      <div class="stack">
        <label class="check"><input name="logo" type="checkbox" ${burn.logo ? 'checked' : ''}> Logo rest</label>
        <div class="form-grid"><label class="form-field"><span>Every (minutes)</span><input name="logoEveryMinutes" type="number" value="${burn.logoEveryMinutes}"></label><label class="form-field"><span>For (seconds)</span><input name="logoSeconds" type="number" value="${burn.logoSeconds}"></label>${mediaPick('logoMediaId', burn.logoMediaId, media, 'Logo rest image')}</div>
        <label class="check"><input name="tone" type="checkbox" ${burn.tone ? 'checked' : ''}> Tone shift to the light palette</label>
        <div class="form-grid"><label class="form-field"><span>Every (minutes)</span><input name="toneEveryMinutes" type="number" value="${burn.toneEveryMinutes}"></label><label class="form-field"><span>Fade (seconds)</span><input name="toneFadeSeconds" type="number" value="${burn.toneFadeSeconds}"></label><label class="form-field"><span>Hold (seconds)</span><input name="toneHoldSeconds" type="number" value="${burn.toneHoldSeconds}"></label></div>
        <div class="row"><button class="btn btn-sm" data-action="burn-logo" type="button">Preview logo rest</button><button class="btn btn-sm" data-action="burn-tone" type="button">Preview tone shift</button></div>
      </div>
    </div>
    <div ${show('publish')}>
      <h3>Publish</h3>
      <p>${screen.version ? `Version <strong>${screen.version}</strong> is live.` : 'Nothing is published yet; displays show the seal until you publish.'} ${dirty(screen) ? '<span class="status-pill status-warn">unpublished changes</span>' : '<span class="status-pill status-running">draft matches live</span>'}</p>
      <p class="hint">Publishing snapshots the draft. Displays poll every 10 seconds and keep the last good page if the Pi is briefly unreachable.</p>
      <div class="row"><button class="btn btn-primary" type="button" onclick="document.querySelector('#publish').click()">Publish now</button><button class="btn" type="button" onclick="document.querySelector('#revert').click()">Revert draft</button></div>
      <h3>Display URL</h3>
      <pre class="code">${escapeHtml(location.origin)}/screen/${escapeHtml(screen.slug)}</pre>
      <label class="form-field"><span>Address slug</span><input name="slug" value="${escapeAttr(screen.slug)}" pattern="[a-z0-9-]+"><small>Changing it changes the URL displays must open.</small></label>
      <h3>Danger zone</h3>
      <a class="btn btn-danger btn-sm" href="#/screens">Delete from the Screens list</a>
    </div>`
  const state_ = document.querySelector('#pub-state')
  if (state_) state_.innerHTML = dirty(screen) ? '<span class="status-pill status-warn">unpublished changes</span>' : screen.version ? `<span class="status-pill status-running">live v${screen.version}</span>` : '<span class="status-pill status-idle">not published</span>'
  const frame = document.querySelector('#preview')
  if (frame) { frame.dataset.width = screen.mode.width; frame.dataset.height = screen.mode.height; fitPreview() }
  let dragFrom = null
  form.querySelectorAll('[draggable="true"]').forEach((field) => {
    field.addEventListener('dragstart', () => { dragFrom = field.dataset.slide ?? field.dataset.entry })
    field.addEventListener('dragover', (event) => event.preventDefault())
    field.addEventListener('drop', (event) => {
      event.preventDefault()
      const key = field.dataset.slide != null ? 'slide' : 'entry'
      const list = key === 'slide' ? state.dataset.rows : state.screen.draft.entries
      const from = Number(dragFrom)
      const to = Number(field.dataset[key])
      if (!list || from === to || Number.isNaN(from)) return
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item)
      drawForm(form, state)
      queueSave(state)
    })
  })
}
function dirty(screen) {
  return JSON.stringify(screen.draft) !== JSON.stringify(screen.published)
}
function color(name, label, value) {
  return `<label class="form-field"><span>${label}</span><input name="${name}" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000')}"></label>`
}
function mediaPick(name, value, items, label) {
  const item = items.find((entry) => entry.id === value)
  return `<div class="form-field wide"><span>${label}</span><div class="media-pick">${item ? `<img src="/media/${item.id}" alt="">` : '<div class="none">none</div>'}<input type="hidden" name="${name}" value="${escapeAttr(value || '')}"><button class="btn btn-sm" type="button" data-action="pick-media" data-target="${name}">${item ? 'Change' : 'Choose'}</button>${item ? `<button class="btn btn-ghost btn-sm" type="button" data-action="clear-media" data-target="${name}">Clear</button>` : ''}</div></div>`
}
async function pickMedia(state, current) {
  state.mediaItems = await api('/api/media')
  return new Promise((resolve) => {
    const overlay = openModal(`<h2>Choose an image</h2>
      <div class="row spread" style="margin-bottom:12px"><span class="hint">JPEG or PNG under 15 MB. Photo metadata is stripped on upload.</span><label class="btn btn-sm">Upload new<input type="file" accept="image/*" hidden id="pick-upload"></label></div>
      <div class="media-grid">${state.mediaItems.map((item) => `<button class="media-tile ${item.id === current ? 'selected' : ''}" type="button" data-id="${item.id}"><img src="/media/${item.id}" alt=""><span>${escapeHtml(item.filename)}</span></button>`).join('') || '<div class="empty-state" style="grid-column:1/-1">No images yet. Upload one.</div>'}</div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" type="button" id="pick-cancel">Cancel</button></div>`)
    let done = false
    const finish = (value) => { if (done) return; done = true; closeModal(); resolve(value) }
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(undefined) })
    overlay.querySelector('#pick-cancel').onclick = () => finish(undefined)
    overlay.querySelectorAll('.media-tile').forEach((tile) => { tile.onclick = () => finish(tile.dataset.id) })
    overlay.querySelector('#pick-upload').onchange = async (event) => {
      const file = event.target.files[0]
      if (!file) return
      const data = new FormData()
      data.append('folder', 'photos')
      data.append('file', file)
      try {
        const uploaded = await api('/api/media', { method: 'POST', body: data })
        finish(uploaded.id)
      } catch (error) { toast(error.message, 'err') }
    }
  })
}

function layoutFields(state) {
  const layout = state.screen.draft.layout
  const media = state.mediaItems
  return `<label class="check" style="margin-bottom:10px"><input name="layoutEnabled" type="checkbox" ${layout.enabled ? 'checked' : ''}> Use layout mode (background photo with floating panels)</label>
    <p class="hint">Off: the template fills the whole screen. On: you place the template content and any extra panels anywhere over a background photo. Panels scroll their content slowly when the data is taller than the box.</p>
    <h3>Start from a preset</h3>
    <div class="preset-grid">${Object.entries(PRESETS).map(([key, preset]) => `<button class="preset" type="button" data-action="preset" data-preset="${key}"><div class="mini">${preset.mini.map(([x, y, w, h]) => `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"></i>`).join('')}</div>${preset.label}</button>`).join('')}</div>
    <h3>Background</h3>
    <div class="form-grid">
      ${mediaPick('backgroundMediaId', layout.backgroundMediaId, media, 'Background photo')}
      <label class="form-field"><span>Photo fit</span><select name="backgroundFit">${[['cover', 'Fill the screen'], ['contain', 'Show the whole photo']].map(([key, label]) => `<option value="${key}" ${layout.backgroundFit === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="form-field"><span>Darken ${layout.dim}%</span><input name="dim" type="range" min="0" max="90" value="${layout.dim}"></label>
      <label class="form-field"><span>Blur ${layout.blur}px</span><input name="blur" type="range" min="0" max="24" value="${layout.blur}"></label>
    </div>
    <h3>Panels</h3>
    <div class="row" style="margin-bottom:10px">${[['content', 'Template content'], ['text', 'Text'], ['image', 'Photo or logo'], ['clock', 'Clock']].map(([kind, label]) => `<button class="btn btn-sm" type="button" data-action="add-section" data-kind="${kind}">+ ${label}</button>`).join('')}</div>
    ${layout.sections.map((section, index) => sectionFields(section, index, layout.sections.length, state)).join('') || '<div class="empty-state">No panels. Add the template content panel to get started.</div>'}`
}
function sectionFields(section, index, count, state) {
  const label = { content: 'Template content', text: 'Text panel', image: 'Photo or logo', clock: 'Clock' }[section.kind] || section.kind
  const fill = parseColor(section.fill)
  const selected = state.selected === section.id
  return `<details class="section-item ${selected ? 'selected' : ''}" data-sid="${section.id}" ${selected ? 'open' : ''}>
    <summary data-action="select-section" data-sid="${section.id}"><span><span class="badge">${index + 1}</span> ${label}${section.kind === 'text' && section.title ? ` · ${escapeHtml(section.title)}` : ''}</span><span class="row tight"><button class="btn btn-ghost btn-sm" type="button" data-action="move-section" data-sid="${section.id}" data-dir="-1" title="Send backward" ${index === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost btn-sm" type="button" data-action="move-section" data-sid="${section.id}" data-dir="1" title="Bring forward" ${index === count - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-ghost btn-sm" type="button" data-action="dup-section" data-sid="${section.id}" title="Duplicate">⧉</button><button class="btn btn-ghost btn-sm" type="button" data-action="remove-section" data-sid="${section.id}" title="Remove">✕</button></span></summary>
    <div class="body">
      ${section.kind === 'text' ? `<div class="form-grid"><label class="form-field wide"><span>Heading</span><input data-sf="title" value="${escapeAttr(section.title || '')}"></label><label class="form-field wide"><span>Text</span><textarea data-sf="body">${escapeHtml(section.body || '')}</textarea></label></div>` : ''}
      ${section.kind === 'image' ? `<div class="form-grid">${mediaPick(`section-media-${section.id}`, section.mediaId, state.mediaItems, 'Image')}<label class="form-field"><span>Fit</span><select data-sf="fit">${[['contain', 'Show all'], ['cover', 'Fill and crop']].map(([key, text]) => `<option value="${key}" ${section.fit === key ? 'selected' : ''}>${text}</option>`).join('')}</select></label></div>` : ''}
      ${section.kind === 'clock' ? `<label class="check"><input data-sf="showDate" type="checkbox" ${section.showDate ? 'checked' : ''}> Show the date</label>` : ''}
      ${section.kind === 'content' ? `<label class="form-field"><span>When data is taller than the box</span><select data-sf="scroll">${[['auto', 'Scroll slowly'], ['fit', 'Shrink to fit'], ['clip', 'Cut off']].map(([key, text]) => `<option value="${key}" ${(section.scroll || 'auto') === key ? 'selected' : ''}>${text}</option>`).join('')}</select></label>` : ''}
      <div class="form-grid" style="grid-template-columns:repeat(4,1fr);margin-top:8px">
        <label class="form-field"><span>Left %</span><input data-sf="x" type="number" step="0.5" value="${section.x}"></label>
        <label class="form-field"><span>Top %</span><input data-sf="y" type="number" step="0.5" value="${section.y}"></label>
        <label class="form-field"><span>Width %</span><input data-sf="w" type="number" step="0.5" value="${section.w}"></label>
        <label class="form-field"><span>Height %</span><input data-sf="h" type="number" step="0.5" value="${section.h}"></label>
      </div>
      <div class="form-grid" style="margin-top:8px">
        <label class="form-field"><span>Panel color</span><input data-fill-color type="color" value="${fill.hex}"></label>
        <label class="form-field"><span>Opacity ${Math.round(fill.alpha * 100)}%</span><input data-fill-alpha type="range" min="0" max="100" value="${Math.round(fill.alpha * 100)}"></label>
        <label class="form-field"><span>Corner radius</span><input data-sf="radius" type="number" min="0" max="120" value="${section.radius ?? 0}"></label>
        <label class="form-field"><span>Padding %</span><input data-sf="padding" type="number" min="0" max="20" step="0.5" value="${section.padding ?? 0}"></label>
        ${section.kind !== 'content' ? `<label class="form-field"><span>Text size ${section.font || 100}%</span><input data-sf="font" type="range" min="50" max="300" value="${section.font || 100}"></label><label class="form-field"><span>Align</span><select data-sf="align">${['left', 'center', 'right'].map((key) => `<option ${section.align === key ? 'selected' : ''}>${key}</option>`).join('')}</select></label>` : ''}
        <label class="form-field"><span><label class="check"><input data-ink-on type="checkbox" ${section.ink ? 'checked' : ''}> Own text color</label></span><input data-ink-color type="color" value="${parseColor(section.ink || '#ffffff').hex}"></label>
        <label class="form-field"><span><label class="check"><input data-border-on type="checkbox" ${section.border ? 'checked' : ''}> Border</label></span><input data-border-color type="color" value="${parseColor(section.border || '#c4a35a').hex}"></label>
        <label class="check"><input data-sf="shadow" type="checkbox" ${section.shadow ? 'checked' : ''}> Drop shadow</label>
      </div>
    </div>
  </details>`
}
function parseColor(value) {
  const text = String(value || '').trim()
  let match = /^#([0-9a-f]{6})$/i.exec(text)
  if (match) return { hex: `#${match[1].toLowerCase()}`, alpha: 1 }
  match = /^#([0-9a-f]{3})$/i.exec(text)
  if (match) return { hex: `#${[...match[1]].map((ch) => ch + ch).join('').toLowerCase()}`, alpha: 1 }
  match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text)
  if (match) return { hex: `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`, alpha: match[4] === undefined ? 1 : Number(match[4]) }
  if (text === 'transparent' || text === '') return { hex: '#0c2340', alpha: 0 }
  return { hex: '#0c2340', alpha: 1 }
}
function toRgba(hex, alpha) {
  const parsed = parseColor(hex)
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(parsed.hex.slice(start, start + 2), 16))
  if (alpha <= 0) return 'transparent'
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`
}

function templateFields(state) {
  const screen = state.screen
  const media = state.mediaItems
  if (screen.template === 'award') {
    const current = screen.draft.current || {}
    return `<h3>Board</h3><label class="form-field"><span>Title</span><input name="title" value="${escapeAttr(screen.draft.title || '')}"></label>
      <h3>Current honoree</h3>
      <div class="form-grid">
        <label class="form-field wide"><span>Name</span><input name="honoreeName" value="${escapeAttr(current.name || '')}"></label>
        <label class="form-field"><span>Badge</span><input name="badgeNumber" value="${escapeAttr(current.badgeNumber || '')}"></label>
        <label class="form-field"><span>Award year</span><input name="awardYear" value="${escapeAttr(current.awardYear || '')}"></label>
        <label class="form-field"><span>Rank</span><input name="rank" value="${escapeAttr(current.rank || '')}"></label>
        <label class="form-field"><span>Hire date</span><input name="hireDate" value="${escapeAttr(current.hireDate || '')}"></label>
        <label class="form-field"><span>Years of service</span><input name="yearsOfService" value="${escapeAttr(current.yearsOfService || '')}"></label>
        ${mediaPick('photoId', current.photoId, media, 'Officer photo')}
      </div>
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" data-action="history" type="button">Move current honoree to previous recipients</button></div>
      <h3>Previous recipients <span class="badge">${state.dataset?.rows.length || 0}</span></h3>
      ${(state.dataset?.rows || []).map((row, index) => `<fieldset data-row="${index}"><legend>${escapeHtml(row.name || 'Recipient')}${row.awardYear ? ` · ${escapeHtml(row.awardYear)}` : ''}</legend><div class="form-grid">
        <label class="form-field wide"><span>Name</span><input data-field="name" value="${escapeAttr(row.name || '')}"></label>
        <label class="form-field"><span>Badge</span><input data-field="badgeNumber" value="${escapeAttr(row.badgeNumber || '')}"></label>
        <label class="form-field"><span>Award year</span><input data-field="awardYear" value="${escapeAttr(row.awardYear || '')}"></label>
        <label class="form-field"><span>Rank</span><input data-field="rank" value="${escapeAttr(row.rank || '')}"></label>
        <label class="form-field"><span>Years of service</span><input data-field="yearsOfService" value="${escapeAttr(row.yearsOfService || '')}"></label>
        ${mediaPick(`rowMedia-${index}`, row.photoId, media, 'Photo')}
      </div><div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="remove-row" data-index="${index}">Remove</button></div></fieldset>`).join('')}
      <button class="btn btn-sm" data-action="add-row" type="button">+ Add previous recipient</button>`
  }
  if (screen.template === 'directory') {
    return `<h3>Directory</h3><label class="form-field"><span>Title</span><input name="title" value="${escapeAttr(screen.draft.title || '')}"></label>
      <h3>Cards <span class="badge">${state.dataset?.rows.length || 0}</span></h3>
      <p class="hint">Cards sort alphabetically on the display. Logos show beside the name and in the tap-to-detail card.</p>
      ${(state.dataset?.rows || []).map((row, index) => `<fieldset data-row="${index}"><legend>${escapeHtml(row.name || 'Card')}</legend><div class="form-grid">
        <label class="form-field wide"><span>Name</span><input data-field="name" value="${escapeAttr(row.name || '')}"></label>
        <label class="form-field"><span>Subtitle</span><input data-field="subtitle" value="${escapeAttr(row.subtitle || '')}"></label>
        <label class="form-field"><span>Phone</span><input data-field="phone" value="${escapeAttr(row.phone || '')}"></label>
        <label class="form-field"><span>Address</span><input data-field="address" value="${escapeAttr(row.address || '')}"></label>
        <label class="form-field"><span>Hours</span><input data-field="hours" value="${escapeAttr(row.hours || '')}"></label>
        <label class="form-field wide"><span>Notes</span><input data-field="details" value="${escapeAttr(row.details || '')}"></label>
        ${mediaPick(`rowMedia-${index}`, row.logoId, media, 'Logo')}
      </div><div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="remove-row" data-index="${index}">Remove</button></div></fieldset>`).join('')}
      <button class="btn btn-sm" data-action="add-row" type="button">+ Add card</button>
      <h3>CSV import</h3>
      <label class="form-field"><span>Paste CSV with a header row</span><textarea name="csv" placeholder="name,subtitle,phone,address,hours,details"></textarea></label>
      <label class="check"><input name="replace" type="checkbox"> Remove cards that are not in the file</label>
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" data-action="import" type="button">Import CSV</button></div>`
  }
  if (screen.template === 'slides') {
    return `<h3>Slides <span class="badge">${state.dataset?.rows.length || 0}</span></h3><p class="hint">Drag a slide to reorder. Days use 0–6 (Sunday is 0); leave blank for every day.</p>
      ${(state.dataset?.rows || []).map((slide, index) => `<fieldset draggable="true" data-slide="${index}"><legend>${index + 1}. ${escapeHtml(slide.title || 'Slide')}</legend><div class="form-grid">
        <label class="form-field wide"><span>Title</span><input data-field="title" value="${escapeAttr(slide.title || '')}"></label>
        <div class="form-field wide"><span>Text</span><div class="rich" contenteditable="true" data-html="${index}">${slide.bodyHtml || ''}</div></div>
        <label class="form-field"><span>QR link</span><input data-field="qrUrl" value="${escapeAttr(slide.qrUrl || '')}"></label>
        <label class="form-field"><span>QR caption</span><input data-field="qrLabel" value="${escapeAttr(slide.qrLabel || '')}"></label>
        <label class="form-field"><span>Seconds</span><input data-field="durationSec" type="number" value="${slide.durationSec || 12}"></label>
        <label class="form-field"><span>Days</span><input data-field="days" value="${(slide.days || []).join(',')}" placeholder="1,2,3,4,5"></label>
        <label class="form-field"><span>Start</span><input data-field="startTime" value="${escapeAttr(slide.startTime || '')}" placeholder="09:00"></label>
        <label class="form-field"><span>End</span><input data-field="endTime" value="${escapeAttr(slide.endTime || '')}" placeholder="17:00"></label>
        ${mediaPick(`slideImage-${index}`, slide.imageId, media, 'Background photo')}
      </div><div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="remove-slide" data-index="${index}">Remove</button></div></fieldset>`).join('')}
      <button class="btn btn-sm" data-action="add-slide" type="button">+ Add slide</button>`
  }
  const family = screen.mode.family
  const choices = (state.allScreens || []).filter((item) => item.id !== screen.id && item.template !== 'playlist' && item.mode.family === family)
  return `<h3>Playlist</h3><p class="hint">Only screens in the ${escapeHtml(family)} family are listed so nothing is stretched. Drag to reorder.</p>
    ${(screen.draft.entries || []).map((entry, index) => `<fieldset draggable="true" data-entry="${index}"><legend>${index + 1}</legend><div class="form-grid">
      <label class="form-field wide"><span>Screen</span><select data-field="screenId"><option value="">Choose</option>${choices.map((item) => `<option value="${item.id}" ${item.id === entry.screenId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
      <label class="form-field"><span>Seconds</span><input data-field="durationSec" type="number" value="${entry.durationSec || 15}"></label>
      <label class="form-field"><span>Days</span><input data-field="days" value="${(entry.days || []).join(',')}"></label>
      <label class="form-field"><span>Start</span><input data-field="startTime" value="${escapeAttr(entry.startTime || '')}"></label>
      <label class="form-field"><span>End</span><input data-field="endTime" value="${escapeAttr(entry.endTime || '')}"></label>
    </div><div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm btn-danger" type="button" data-action="remove-entry" data-index="${index}">Remove</button></div></fieldset>`).join('')}
    <button class="btn btn-sm" data-action="add-entry" type="button">+ Add screen</button>`
}

function readForm(form, state) {
  const data = new FormData(form)
  const screen = state.screen
  screen.name = data.get('name') || screen.name
  if (data.get('slug') && /^[a-z0-9-]+$/.test(data.get('slug'))) screen.slug = data.get('slug')
  screen.turn = data.get('turn') || screen.turn
  const mode = state.modes.find((item) => item.id === data.get('modeId'))
  if (mode) screen.mode = mode
  if (data.get('modeId') === 'custom') screen.mode = { width: Number(data.get('customWidth') || screen.mode.width), height: Number(data.get('customHeight') || screen.mode.height) }
  const p = screen.presentation
  p.motion = data.get('motion') || p.motion
  p.listOverflow = data.get('listOverflow') || p.listOverflow
  p.scrollSecondsPerRow = Number(data.get('scrollSecondsPerRow') || 12)
  p.showClock = data.get('showClock') === 'on'
  p.showWeather = data.get('showWeather') === 'on'
  p.progress = data.get('progress') === 'on'
  p.details = data.get('details') === 'on'
  p.detailsSeconds = Math.max(5, Number(data.get('detailsSeconds') || 30))
  p.burnIn.logo = data.get('logo') === 'on'
  p.burnIn.tone = data.get('tone') === 'on'
  p.burnIn.logoEveryMinutes = Number(data.get('logoEveryMinutes') || 30)
  p.burnIn.logoSeconds = Number(data.get('logoSeconds') || 8)
  p.burnIn.logoMediaId = data.get('logoMediaId') || null
  p.burnIn.toneEveryMinutes = Number(data.get('toneEveryMinutes') || 60)
  p.burnIn.toneFadeSeconds = Number(data.get('toneFadeSeconds') || 30)
  p.burnIn.toneHoldSeconds = Number(data.get('toneHoldSeconds') || 45)
  const b = screen.draft.branding || (screen.draft.branding = {})
  b.agencyName = data.get('agencyName') ?? b.agencyName
  b.sheriffLine = data.get('sheriffLine') ?? ''
  for (const key of ['primary', 'accent', 'ink', 'plate', 'lightBg', 'lightInk']) if (data.get(key)) b[key] = data.get(key)
  b.font = data.get('font') || 'sans'
  b.sealMediaId = data.get('sealMediaId') || null
  b.badgeMediaId = data.get('badgeMediaId') || null
  const layout = screen.draft.layout
  layout.enabled = data.get('layoutEnabled') === 'on'
  layout.backgroundMediaId = data.get('backgroundMediaId') || null
  layout.backgroundFit = data.get('backgroundFit') || 'cover'
  layout.dim = Number(data.get('dim') ?? layout.dim)
  layout.blur = Number(data.get('blur') ?? layout.blur)
  form.querySelectorAll('.section-item[data-sid]').forEach((node) => {
    const section = layout.sections.find((item) => item.id === node.dataset.sid)
    if (!section) return
    node.querySelectorAll('[data-sf]').forEach((input) => {
      const key = input.dataset.sf
      if (input.type === 'checkbox') section[key] = input.checked
      else if (input.type === 'number' || input.type === 'range') section[key] = Number(input.value)
      else section[key] = input.value
    })
    const fillColor = node.querySelector('[data-fill-color]')
    const fillAlpha = node.querySelector('[data-fill-alpha]')
    if (fillColor && fillAlpha) section.fill = toRgba(fillColor.value, Number(fillAlpha.value) / 100)
    section.ink = node.querySelector('[data-ink-on]')?.checked ? node.querySelector('[data-ink-color]').value : ''
    section.border = node.querySelector('[data-border-on]')?.checked ? node.querySelector('[data-border-color]').value : ''
    if (section.kind === 'image') section.mediaId = node.querySelector(`[name="section-media-${section.id}"]`)?.value || null
  })
  if (screen.template === 'award') {
    screen.draft.title = data.get('title') || ''
    screen.draft.current = { ...(screen.draft.current || {}), name: data.get('honoreeName') || '', badgeNumber: data.get('badgeNumber') || '', awardYear: data.get('awardYear') || '', rank: data.get('rank') || '', hireDate: data.get('hireDate') || '', yearsOfService: data.get('yearsOfService') || '', photoId: data.get('photoId') || null }
  }
  if (screen.template === 'directory') screen.draft.title = data.get('title') || ''
  if ((screen.template === 'directory' || screen.template === 'award') && state.dataset) {
    form.querySelectorAll('fieldset[data-row]').forEach((row) => {
      const item = state.dataset.rows[Number(row.dataset.row)]
      if (!item) return
      row.querySelectorAll('[data-field]').forEach((input) => { item[input.dataset.field] = input.value })
      const mediaId = row.querySelector(`[name="rowMedia-${row.dataset.row}"]`)?.value || null
      if (screen.template === 'directory') item.logoId = mediaId
      else item.photoId = mediaId
    })
  }
  if (screen.template === 'slides' && state.dataset) {
    state.dataset.rows = [...form.querySelectorAll('fieldset[data-slide]')].map((field) => {
      const index = Number(field.dataset.slide)
      const item = { ...(state.dataset.rows[index] || { id: crypto.randomUUID() }) }
      field.querySelectorAll('[data-field]').forEach((input) => {
        if (input.dataset.field === 'days') item.days = input.value.split(',').map((part) => Number(part.trim())).filter((part) => part >= 0 && part <= 6 && input.value.trim() !== '')
        else if (input.dataset.field === 'durationSec') item.durationSec = Number(input.value || 12)
        else item[input.dataset.field] = input.value
      })
      const html = field.querySelector('[data-html]')
      if (html) item.bodyHtml = html.innerHTML
      item.imageId = field.querySelector(`[name="slideImage-${index}"]`)?.value || null
      return item
    })
  }
  if (screen.template === 'playlist') {
    screen.draft.entries = [...form.querySelectorAll('fieldset[data-entry]')].map((field) => {
      const index = Number(field.dataset.entry)
      const item = { ...(screen.draft.entries[index] || { id: crypto.randomUUID() }) }
      field.querySelectorAll('[data-field]').forEach((input) => {
        if (input.dataset.field === 'days') item.days = input.value.split(',').map((part) => Number(part.trim())).filter((part) => part >= 0 && part <= 6 && input.value.trim() !== '')
        else if (input.dataset.field === 'durationSec') item.durationSec = Number(input.value || 15)
        else item[input.dataset.field] = input.value
      })
      return item
    })
  }
  const frame = document.querySelector('#preview')
  if (frame) { frame.dataset.width = screen.mode.width; frame.dataset.height = screen.mode.height }
  form.querySelectorAll('input[type=range]').forEach((input) => {
    const span = input.closest('.form-field')?.querySelector('span')
    if (span) span.textContent = span.textContent.replace(/\d+(%|px)?$/, `${input.value}${/px/.test(span.textContent) ? 'px' : /%/.test(span.textContent) ? '%' : ''}`)
  })
}

let saveTimer = 0
function queueSave(state, quick = false) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(state).catch(fail), quick ? 150 : 400)
}
async function save(state) {
  const before = state.screen.slug
  state.screen = await api(`/api/screens/${state.screen.id}`, { method: 'PUT', body: JSON.stringify({ name: state.screen.name, slug: state.screen.slug, mode: state.screen.mode, turn: state.screen.turn, presentation: state.screen.presentation, draft: state.screen.draft }) })
  if (state.dataset) await api(`/api/datasets/${state.dataset.id}`, { method: 'PUT', body: JSON.stringify({ rows: state.dataset.rows, source: state.dataset.source, sourceUrl: state.dataset.sourceUrl }) })
  const frame = document.querySelector('#preview')
  if (frame && before !== state.screen.slug) frame.src = `/screen/${state.screen.slug}?preview=1`
  else frame?.contentWindow?.postMessage({ type: 'signage-refresh' }, location.origin)
  const pub = document.querySelector('#pub-state')
  if (pub) pub.innerHTML = dirty(state.screen) ? '<span class="status-pill status-warn">unpublished changes</span>' : state.screen.version ? `<span class="status-pill status-running">live v${state.screen.version}</span>` : '<span class="status-pill status-idle">not published</span>'
  fitPreview()
}
function setPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]] || (cursor[parts[i]] = {})
  cursor[parts.at(-1)] = value
}
function addRow(state) {
  if (state.screen.template === 'award') state.dataset.rows.push({ id: crypto.randomUUID(), name: 'Name', badgeNumber: '', awardYear: '', rank: '', hireDate: '', yearsOfService: '', photoId: null })
  else state.dataset.rows.push({ id: crypto.randomUUID(), name: 'New card', subtitle: '', phone: '', address: '', hours: '', details: '', logoId: null })
}
function addSlide(state) {
  state.dataset.rows.push({ id: crypto.randomUUID(), title: 'Announcement', bodyHtml: '<p></p>', qrUrl: '', qrLabel: '', imageId: null, durationSec: 12, days: [], startTime: '', endTime: '' })
}
function addEntry(state) {
  state.screen.draft.entries.push({ id: crypto.randomUUID(), screenId: '', durationSec: 15, days: [], startTime: '', endTime: '' })
}

/* ---------- Datasets ---------- */
async function datasets() {
  const [rows, screens] = await Promise.all([api('/api/datasets'), api('/api/screens')])
  shell('datasets', `<div class="help-card">Every screen owns a dataset (honorees, cards, or slides). Edit rows inside the screen editor, or point a dataset at a JSON file on your LAN to pull it on a schedule. Public internet sources are refused on purpose.</div>
    <div class="cards-grid">${rows.map((item) => `<article class="card">
      <div class="card-title">${escapeHtml(item.name)}<span class="badge">${escapeHtml(item.kind)}</span></div>
      <div class="card-desc">${item.rows.length} row${item.rows.length === 1 ? '' : 's'} · ${item.source === 'lan-http' ? 'pulled from LAN' : 'edited here'}${item.lastFetch ? ` · fetched ${ago(item.lastFetch)}` : ''}</div>
      <div class="card-meta" style="margin-top:6px">Used by ${screens.filter((screen) => screen.datasetId === item.id).map((screen) => `<a href="#/screens/${screen.id}">${escapeHtml(screen.name)}</a>`).join(', ') || 'no screen'}</div>
      ${item.lastError ? `<div class="alert alert-danger" style="margin-top:10px">${escapeHtml(item.lastError)}</div>` : ''}
      <form data-id="${item.id}" class="row" style="margin-top:12px"><input class="input" style="flex:1" name="sourceUrl" value="${escapeAttr(item.sourceUrl || '')}" placeholder="http://10.0.0.5/cards.json"><button class="btn btn-sm">Pull now</button></form>
    </article>`).join('') || '<div class="empty-state">Datasets appear when you create screens.</div>'}</div>`,
  { title: 'Datasets', subtitle: 'The rows behind each screen' })
  document.querySelectorAll('form[data-id]').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault()
      const id = form.dataset.id
      try {
        await api(`/api/datasets/${id}`, { method: 'PUT', body: JSON.stringify({ source: 'lan-http', sourceUrl: new FormData(form).get('sourceUrl') }) })
        await api(`/api/datasets/${id}/fetch`, { method: 'POST', body: '{}' })
        toast('Pulled', 'ok')
        datasets()
      } catch (error) { toast(error.message, 'err') }
    }
  })
}

/* ---------- Media ---------- */
async function media() {
  const items = await api('/api/media')
  const folders = [...new Set(items.map((item) => item.folder))]
  shell('media', `<form id="upload" class="upload-area"><p><strong>Drop images here</strong> or <label class="btn btn-sm">choose files<input name="file" type="file" accept="image/*" multiple hidden></label></p><div class="row" style="justify-content:center"><label class="form-field" style="width:160px"><span>Folder</span><select name="folder"><option>photos</option><option>logos</option><option>seals</option><option>backgrounds</option></select></label></div><p class="hint">JPEG or PNG under 15 MB each. Camera metadata is removed. Aim for 3840 px or smaller on the long side so the Pi stays quick.</p></form>
    ${folders.map((folder) => `<div class="section-title"><span>${escapeHtml(folder)}</span><span class="card-meta">${items.filter((item) => item.folder === folder).length}</span></div><div class="media-grid">${items.filter((item) => item.folder === folder).map((item) => `<div class="media-tile" style="cursor:default"><img src="/media/${item.id}" alt="" loading="lazy"><span title="${escapeAttr(item.filename)}">${escapeHtml(item.filename)}</span><div class="row tight" style="padding:0 6px 6px"><button class="btn btn-ghost btn-sm" type="button" data-copy="${item.id}" title="Copy media id">id</button><button class="btn btn-ghost btn-sm btn-danger" type="button" data-id="${item.id}">Delete</button></div></div>`).join('')}</div>`).join('') || '<div class="empty-state" style="margin-top:16px">No images yet.</div>'}`,
  { title: 'Media', subtitle: `${items.length} image${items.length === 1 ? '' : 's'} stored on the Pi` })
  bindCopy()
  const form = document.querySelector('#upload')
  const upload = async (files) => {
    for (const file of files) {
      const data = new FormData()
      data.append('folder', form.folder.value)
      data.append('file', file)
      try { await api('/api/media', { method: 'POST', body: data }) } catch (error) { toast(`${file.name}: ${error.message}`, 'err') }
    }
    toast(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`, 'ok')
    media()
  }
  form.file.onchange = () => upload([...form.file.files])
  form.addEventListener('dragover', (event) => { event.preventDefault(); form.classList.add('over') })
  form.addEventListener('dragleave', () => form.classList.remove('over'))
  form.addEventListener('drop', (event) => { event.preventDefault(); form.classList.remove('over'); upload([...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'))) })
  document.querySelectorAll('button[data-id]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('Delete this image? Screens using it will show an empty slot.')) return
      await api(`/api/media/${button.dataset.id}`, { method: 'DELETE' })
      media()
    }
  })
}

/* ---------- Settings ---------- */
async function settings() {
  const [agencyRow, override, users, screens, mediaItems] = await Promise.all([api('/api/agency'), api('/api/override'), me.role === 'admin' ? api('/api/users') : [], api('/api/screens'), api('/api/media')])
  const logo = mediaItems.find((item) => item.id === agencyRow.logoMediaId)
  shell('settings', `
    <form id="agency" class="form-panel"><h2>Agency and admin look</h2><div class="form-grid">
      <label class="form-field"><span>Agency name (admin header)</span><input name="name" value="${escapeAttr(agencyRow.name || '')}" ${me.role !== 'admin' ? 'disabled' : ''}></label>
      <label class="form-field"><span>Admin theme</span><select name="theme" ${me.role !== 'admin' ? 'disabled' : ''}><option value="dark" ${agencyRow.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${agencyRow.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
      <div class="form-field"><span>Agency logo (admin sidebar)</span><div class="media-pick">${logo ? `<img src="/media/${logo.id}" alt="">` : '<div class="none">none</div>'}<select name="logoMediaId" ${me.role !== 'admin' ? 'disabled' : ''}><option value="">None</option>${mediaItems.map((item) => `<option value="${item.id}" ${item.id === agencyRow.logoMediaId ? 'selected' : ''}>${escapeHtml(item.filename)}</option>`).join('')}</select></div></div>
      <label class="form-field"><span>Timezone</span><input name="timezone" value="${escapeAttr(agencyRow.timezone)}" ${me.role !== 'admin' ? 'disabled' : ''}></label>
      <label class="form-field"><span>Weather latitude</span><input name="weatherLat" value="${agencyRow.weatherLat ?? ''}" ${me.role !== 'admin' ? 'disabled' : ''}></label>
      <label class="form-field"><span>Weather longitude</span><input name="weatherLon" value="${agencyRow.weatherLon ?? ''}" ${me.role !== 'admin' ? 'disabled' : ''}></label>
    </div>${me.role === 'admin' ? '<div class="row" style="margin-top:12px"><button class="btn btn-primary">Save</button></div>' : '<p class="hint">Only admins change these.</p>'}</form>
    <form id="override" class="form-panel"><h2>Priority override</h2><p class="hint">Interrupts every playlist with a message or another screen until turned off.</p><div class="form-grid">
      <label class="check wide"><input name="active" type="checkbox" ${override.active ? 'checked' : ''}> Active now</label>
      <label class="form-field"><span>Title</span><input name="title" value="${escapeAttr(override.title)}"></label>
      <label class="form-field"><span>Show a screen instead of a message</span><select name="screenId"><option value="">Message only</option>${screens.filter((screen) => screen.template !== 'playlist').map((screen) => `<option value="${screen.id}" ${screen.id === override.screenId ? 'selected' : ''}>${escapeHtml(screen.name)}</option>`).join('')}</select></label>
      <label class="form-field wide"><span>Message</span><textarea name="body">${escapeHtml(override.body)}</textarea></label>
    </div><div class="row" style="margin-top:12px"><button class="btn ${override.active ? 'btn-danger' : 'btn-primary'}">Save override</button></div></form>
    <form id="password" class="form-panel"><h2>Your password</h2><div class="row"><input class="input" style="max-width:280px" name="password" type="password" minlength="8" required placeholder="New password (8+ characters)" autocomplete="new-password"><button class="btn">Change password</button></div></form>
    ${me.role === 'admin' ? `<form id="user" class="form-panel"><h2>Users</h2><table class="table" style="margin-bottom:12px"><thead><tr><th>User</th><th>Role</th><th></th></tr></thead><tbody>${users.map((user) => `<tr><td>${escapeHtml(user.username)}</td><td><span class="badge">${user.role}</span></td><td style="text-align:right">${user.id === me.id ? '<span class="hint">you</span>' : `<button class="btn btn-sm btn-danger" data-user="${user.id}" type="button">Remove</button>`}</td></tr>`).join('')}</tbody></table><div class="row"><input class="input" style="max-width:200px" name="username" placeholder="username" required><input class="input" style="max-width:200px" name="password" type="password" minlength="8" required placeholder="password"><select class="input" style="max-width:140px" name="role"><option value="editor">editor</option><option value="admin">admin</option></select><button class="btn">Add user</button></div><p class="hint" style="margin-top:8px">Editors change content and publish. Admins also manage users, agency settings, backups, and AI tokens.</p></form>
    <div class="form-panel"><h2>Backup and restore</h2><p class="hint">A backup zip holds the database and every image. The Pi also writes a nightly copy of the database to data/backups.</p><div class="row"><a class="btn" href="/api/admin/backup">Download backup</a><form id="restore" class="row"><input class="input" name="file" type="file" accept=".zip" required style="max-width:280px"><button class="btn btn-danger">Restore from zip</button></form></div><p id="restore-msg" class="hint"></p></div>` : ''}`,
  { title: 'Settings', subtitle: 'Agency, override, users, and backups' })
  document.querySelector('#agency').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    data.weatherLat = data.weatherLat === '' ? null : Number(data.weatherLat)
    data.weatherLon = data.weatherLon === '' ? null : Number(data.weatherLon)
    data.logoMediaId = data.logoMediaId || null
    try {
      const saved = await api('/api/agency', { method: 'PUT', body: JSON.stringify(data) })
      agency = { name: saved.name, logoMediaId: saved.logoMediaId, theme: saved.theme }
      localStorage.removeItem('signage-theme')
      applyTheme()
      toast('Saved', 'ok')
      settings()
    } catch (error) { toast(error.message, 'err') }
  }
  document.querySelector('#override').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    data.active = new FormData(event.target).get('active') === 'on'
    await api('/api/override', { method: 'PUT', body: JSON.stringify(data) })
    toast(data.active ? 'Override is active on every playlist' : 'Override saved', data.active ? '' : 'ok')
    settings()
  }
  document.querySelector('#password').onsubmit = async (event) => {
    event.preventDefault()
    try { await api('/api/me/password', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) }); toast('Password changed', 'ok'); event.target.reset() } catch (error) { toast(error.message, 'err') }
  }
  const userForm = document.querySelector('#user')
  if (userForm) {
    userForm.onsubmit = async (event) => { event.preventDefault(); try { await api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(userForm))) }); toast('User added', 'ok'); settings() } catch (error) { toast(error.message, 'err') } }
    userForm.querySelectorAll('[data-user]').forEach((button) => { button.onclick = async () => { if (!confirm('Remove this user?')) return; await api(`/api/users/${button.dataset.user}`, { method: 'DELETE' }); settings() } })
  }
  const restore = document.querySelector('#restore')
  if (restore) restore.onsubmit = async (event) => {
    event.preventDefault()
    if (!confirm('Replace everything on this Pi with the backup? This cannot be undone.')) return
    const response = await fetch('/api/admin/restore', { method: 'POST', body: new FormData(restore), credentials: 'same-origin' })
    document.querySelector('#restore-msg').textContent = response.ok ? 'Backup restored. Reload the page.' : 'Restore failed.'
  }
}

/* ---------- AI access ---------- */
async function aiPage(minted = null) {
  const tokens = me.role === 'admin' ? await api('/api/tokens') : []
  const host = location.origin
  shell('ai', `<div class="help-card"><strong>Let an AI assistant build pages for you.</strong> Create a token below, then hand your assistant the token, this address, and the guide at <a href="/api/docs" target="_blank" rel="noopener">${escapeHtml(host)}/api/docs</a>. The guide explains every template, field, and endpoint so the assistant can create screens, load data, upload photos, and publish. Tokens work from any device on your network; nothing leaves the building.</div>
    ${me.role === 'admin' ? `<div class="form-panel"><h2>Tokens</h2>
      ${tokens.length ? `<table class="table" style="margin-bottom:12px"><thead><tr><th>Name</th><th>Role</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>${tokens.map((token) => `<tr><td>${escapeHtml(token.name)}</td><td><span class="badge">${token.role}</span></td><td class="card-meta">${ago(token.created_at)}</td><td class="card-meta">${token.last_used ? ago(token.last_used) : 'never'}</td><td style="text-align:right"><button class="btn btn-sm btn-danger" type="button" data-token="${token.id}">Revoke</button></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No tokens yet.</p>'}
      <form id="mint" class="row"><input class="input" style="max-width:240px" name="name" placeholder="Token name, e.g. Claude on my laptop" required><select class="input" style="max-width:150px" name="role"><option value="editor">editor</option><option value="admin">admin</option></select><button class="btn btn-primary">Create token</button></form>
      ${minted ? `<div class="alert alert-ok" style="margin-top:12px">Token for <strong>${escapeHtml(minted.name)}</strong>. Copy it now; it is not shown again.<pre class="code" id="tok" style="margin:8px 0 0">${escapeHtml(minted.token)}</pre><button class="btn btn-sm" type="button" data-copy-el="tok" style="margin-top:8px">Copy token</button></div>` : ''}
    </div>` : '<div class="alert alert-info">Ask an admin to create an AI token.</div>'}
    <div class="form-panel"><h2>What to tell the assistant</h2>
      <pre class="code" id="prompt">You are configuring an Agency Signage server on my local network.
Base URL: ${escapeHtml(host)}
Auth header: Authorization: Bearer &lt;token&gt;
Read ${escapeHtml(host)}/api/docs first, then GET /api/schema.
Create the screens I describe, fill their datasets, upload any photos I give you with POST /api/media/base64, check the result with GET /api/public/screens/&lt;slug&gt;?preview=1, and publish when I confirm.</pre>
      <div class="row"><button class="btn btn-sm" type="button" data-copy-el="prompt">Copy</button><a class="btn btn-sm" href="/api/docs" target="_blank" rel="noopener">Open the guide</a><a class="btn btn-sm" href="/api/schema" target="_blank" rel="noopener">Open the schema</a></div>
    </div>
    <div class="form-panel"><h2>Quick check from a terminal</h2>
      <pre class="code">curl -s -H "Authorization: Bearer sig_..." ${escapeHtml(host)}/api/screens</pre>
      <p class="hint">Self-signed HTTPS: add <code>-k</code> to curl or install the CA from <code>/setup/ca.crt</code>.</p>
    </div>`,
  { title: 'AI access', subtitle: 'API tokens and instructions for assistants' })
  bindCopy()
  document.querySelectorAll('[data-copy-el]').forEach((button) => { button.onclick = async () => { await navigator.clipboard.writeText(document.querySelector(`#${button.dataset.copyEl}`).textContent); toast('Copied', 'ok') } })
  const mint = document.querySelector('#mint')
  if (mint) mint.onsubmit = async (event) => {
    event.preventDefault()
    try {
      const made = await api('/api/tokens', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(mint))) })
      aiPage(made)
    } catch (error) { toast(error.message, 'err') }
  }
  document.querySelectorAll('[data-token]').forEach((button) => { button.onclick = async () => { if (!confirm('Revoke this token?')) return; await api(`/api/tokens/${button.dataset.token}`, { method: 'DELETE' }); aiPage() } })
}

/* ---------- Help ---------- */
function helpPage() {
  shell('help', `<div class="cards-grid">
    <div class="card"><div class="card-title">1. Create a screen</div><div class="card-desc">Pick a template and the display mode that matches the TV (1080p portrait is the lobby default). Every screen gets its own address like <span class="mono">/screen/lobby</span>.</div></div>
    <div class="card"><div class="card-title">2. Edit live</div><div class="card-desc">The editor shows the same page the TV renders. Type into the inspector or click text in the preview. Changes save as a draft automatically.</div></div>
    <div class="card"><div class="card-title">3. Layout mode</div><div class="card-desc">Turn on layout mode to put a photo behind the page and float panels over it: the template content, text notices, logos, and a clock. Drag panels in the preview; pull the corner to resize.</div></div>
    <div class="card"><div class="card-title">4. Photos and logos</div><div class="card-desc">Upload under Media, then choose them for the honoree, previous recipients, directory cards, seals, badges, backgrounds, and image panels.</div></div>
    <div class="card"><div class="card-title">5. Publish</div><div class="card-desc">Displays only show published versions. Revert brings the draft back to what is live. Playlists rotate through screens of the same shape.</div></div>
    <div class="card"><div class="card-title">6. Add a display</div><div class="card-desc">Open <a href="/setup" target="_blank" rel="noopener">/setup</a> on the device or generate an enrollment script for a Pi, Windows, Linux, or Android TV.</div></div>
    <div class="card"><div class="card-title">Touch kiosks</div><div class="card-desc">Turn on "Tap a card to open details" under Display. Visitors tap a card to read more; it closes on its own after the timeout.</div></div>
    <div class="card"><div class="card-title">AI assistants</div><div class="card-desc">Create a token under AI access and share <span class="mono">/api/docs</span>. The assistant can build screens, load rows, upload images, and publish over the API.</div></div>
  </div>
  <div class="section-title"><span>Recovery</span></div>
  <div class="help-card">Forgot the admin password: on the Pi run <code>sudo node /opt/agency-signage/server/reset-password.js admin</code>. Restore a backup under Settings. Logs: <code>journalctl -u agency-signage -f</code>.</div>`,
  { title: 'Help', subtitle: 'How the pieces fit together' })
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function escapeAttr(value) { return escapeHtml(value) }
