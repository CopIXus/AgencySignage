const root = document.querySelector('#root')
let me = null
let timer = 0

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

boot()

async function boot() {
  me = await api('/api/me').catch(() => null)
  render()
  window.addEventListener('hashchange', render)
}

function render() {
  clearInterval(timer)
  if (!me) return login()
  const path = location.hash.replace(/^#/, '') || '/'
  const screenId = /^\/screens\/([^/]+)$/.exec(path)?.[1]
  if (screenId) return editor(screenId)
  if (path === '/screens') return screensPage()
  if (path.startsWith('/datasets')) return datasets()
  if (path.startsWith('/media')) return media()
  if (path.startsWith('/settings')) return settings()
  return dashboard()
}

function shell(active, inner) {
  root.innerHTML = `<div class="shell"><nav>
    <strong>Agency signage</strong>
    <a href="#/" class="${active === 'home' ? 'active' : ''}">Dashboard</a>
    <a href="#/screens" class="${active === 'screens' ? 'active' : ''}">Screens</a>
    <a href="#/datasets" class="${active === 'datasets' ? 'active' : ''}">Datasets</a>
    <a href="#/media" class="${active === 'media' ? 'active' : ''}">Media</a>
    <a href="#/settings" class="${active === 'settings' ? 'active' : ''}">Settings</a>
    <span class="muted">${me.username} · ${me.role}</span>
    <button id="logout" type="button">Sign out</button>
  </nav><main>${inner}</main></div>`
  document.querySelector('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); me = null; render() }
}

function login() {
  root.innerHTML = `<div class="login"><form class="cardish"><h1>Sign in</h1><label>Username <input name="username" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button class="primary" type="submit">Sign in</button><p class="warn" id="err"></p></form></div>`
  root.querySelector('form').onsubmit = async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      me = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) })
      render()
    } catch (error) { root.querySelector('#err').textContent = error.message }
  }
}

async function dashboard() {
  const draw = async () => {
    const dash = await api('/api/dashboard')
    shell('home', `<h1>Dashboard</h1>
      ${dash.clockWarning ? '<p class="warn">The Pi clock looks wrong. Set the time before relying on day and time windows.</p>' : ''}
      ${dash.diskFreeBytes < 500 * 1024 * 1024 ? '<p class="warn">Less than 500 MB is free on the Pi.</p>' : ''}
      <div class="grid">${dash.screens.map((screen) => `<article class="cardish"><h2><a href="#/screens/${screen.id}">${escapeHtml(screen.name)}</a></h2><p>${escapeHtml(screen.template)} · ${screen.mode.width}×${screen.mode.height} · v${screen.version}</p><p>Loaded ${screen.loadCount} times</p>${(screen.players || []).map((player) => `<p class="${player.inUse ? 'ok' : 'muted'}">${escapeHtml(player.deviceName)} ${player.inUse ? 'in use' : 'idle'} · reported v${player.reportedVersion ?? '—'} ${player.width === screen.mode.width && player.height === screen.mode.height ? '· resolution matches' : '· resolution differs'}</p>`).join('') || '<p class="muted">No display has opened this screen.</p>'}</article>`).join('') || '<p>No screens yet. <a href="#/screens">Create one</a>.</p>'}</div>
      <h2>Recent publishes</h2><ul>${dash.publishes.map((item) => `<li>${escapeHtml(item.username)} published version ${item.version} at ${escapeHtml(item.published_at)}</li>`).join('') || '<li class="muted">Nothing published yet.</li>'}</ul>`)
  }
  await draw()
  timer = setInterval(draw, 4000)
}

async function screensPage() {
  const screens = await api('/api/screens')
  const modes = await api('/api/modes')
  shell('screens', `<h1>Screens</h1><form id="create" class="row"><input name="name" placeholder="Screen name" required><select name="template"><option value="award">Award board</option><option value="directory">Directory</option><option value="slides">Slides</option><option value="playlist">Playlist</option></select><select name="modeId">${modes.map((mode) => `<option value="${mode.id}">${escapeHtml(mode.label)}</option>`).join('')}</select><button class="primary">Create</button></form><div class="grid">${screens.map((screen) => `<a class="cardish" href="#/screens/${screen.id}"><strong>${escapeHtml(screen.name)}</strong><p class="muted">${escapeHtml(screen.template)} · /screen/${escapeHtml(screen.slug)} · v${screen.version}</p></a>`).join('')}</div>`)
  document.querySelector('#create').onsubmit = async (event) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.target))
    const screen = await api('/api/screens', { method: 'POST', body: JSON.stringify(data) })
    location.hash = `#/screens/${screen.id}`
  }
}

async function editor(id) {
  const [screen, datasets, modes, mediaItems, allScreens] = await Promise.all([api(`/api/screens/${id}`), api('/api/datasets'), api('/api/modes'), api('/api/media'), api('/api/screens')])
  const dataset = datasets.find((item) => item.id === screen.datasetId)
  shell('screens', `<p><a href="#/screens">Screens</a></p><div class="editor"><div><div class="preview-frame" id="pane"><iframe id="preview" title="Preview"></iframe></div><p class="muted">This is the same page the TV opens: /screen/${escapeHtml(screen.slug)}</p></div><form class="inspector" id="form"></form></div>`)
  const form = document.querySelector('#form')
  const state = { screen, dataset, modes, mediaItems, allScreens }
  drawForm(form, state)
  const frame = document.querySelector('#preview')
  frame.src = `/screen/${screen.slug}?preview=1`
  fitPreview()
  window.addEventListener('resize', fitPreview)
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'signage-edit') return
    setPath(state.screen.draft, event.data.path, event.data.value)
    drawForm(form, state)
    queueSave(state)
  })
  form.addEventListener('input', () => { readForm(form, state); queueSave(state) })
  form.addEventListener('change', () => { readForm(form, state); queueSave(state) })
  form.addEventListener('click', async (event) => {
    const action = event.target.dataset.action
    if (!action) return
    event.preventDefault()
    if (action === 'publish') state.screen = await api(`/api/screens/${id}/publish`, { method: 'POST', body: '{}' })
    if (action === 'revert') state.screen = await api(`/api/screens/${id}/revert`, { method: 'POST', body: '{}' })
    if (action === 'history') state.screen = await api(`/api/screens/${id}/move-to-history`, { method: 'POST', body: '{}' })
    if (action === 'burn-logo' || action === 'burn-tone') frame.contentWindow?.postMessage({ type: 'signage-burn', mode: action === 'burn-logo' ? 'logo' : 'tone' }, location.origin)
    if (action === 'add-row') addRow(state)
    if (action === 'add-slide') addSlide(state)
    if (action === 'add-entry') addEntry(state)
    if (action === 'import' && state.dataset) {
      state.dataset = await api(`/api/datasets/${state.dataset.id}/import`, { method: 'POST', body: JSON.stringify({ csv: form.querySelector('[name=csv]')?.value || '', replace: Boolean(form.querySelector('[name=replace]')?.checked) }) })
    }
    drawForm(form, state)
    if (action !== 'burn-logo' && action !== 'burn-tone') queueSave(state)
  })
}

function fitPreview() {
  const pane = document.querySelector('#pane')
  const frame = document.querySelector('#preview')
  if (!pane || !frame) return
  const screen = frame.dataset.width ? { width: Number(frame.dataset.width), height: Number(frame.dataset.height) } : null
  if (!screen) return
  const scale = Math.min(pane.clientWidth / screen.width, (window.innerHeight - 180) / screen.height)
  frame.style.width = `${screen.width}px`
  frame.style.height = `${screen.height}px`
  frame.style.transform = `scale(${scale})`
  frame.style.transformOrigin = 'top left'
  pane.style.height = `${screen.height * scale}px`
}

function drawForm(form, state) {
  const screen = state.screen
  const draft = screen.draft
  const burn = screen.presentation.burnIn
  form.innerHTML = `<label>Name <input name="name" value="${escapeAttr(screen.name)}"></label>
    <label>Mode <select name="modeId">${state.modes.map((mode) => `<option value="${mode.id}" ${mode.id === screen.mode.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}<option value="custom" ${String(screen.mode.id).startsWith('custom-') ? 'selected' : ''}>Custom</option></select></label>
    <label>Custom width <input name="customWidth" type="number" min="640" max="4096" value="${screen.mode.width}"></label>
    <label>Custom height <input name="customHeight" type="number" min="640" max="4096" value="${screen.mode.height}"></label>
    <label>Turn when the TV is the other way <select name="turn">${['none', 'clockwise', 'counterclockwise'].map((turn) => `<option ${turn === screen.turn ? 'selected' : ''}>${turn}</option>`).join('')}</select></label>
    <label>Motion <select name="motion">${['off', 'subtle', 'smooth'].map((motion) => `<option ${motion === screen.presentation.motion ? 'selected' : ''}>${motion}</option>`).join('')}</select></label>
    <label>List overflow <select name="listOverflow">${['fit', 'slow-scroll'].map((item) => `<option value="${item}" ${item === screen.presentation.listOverflow ? 'selected' : ''}>${item}</option>`).join('')}</select></label>
    <label>Seconds per row <input name="scrollSecondsPerRow" type="number" min="4" value="${screen.presentation.scrollSecondsPerRow}"></label>
    <label><input name="showClock" type="checkbox" ${screen.presentation.showClock ? 'checked' : ''}> Clock</label>
    <label><input name="showWeather" type="checkbox" ${screen.presentation.showWeather ? 'checked' : ''}> Weather</label>
    <label><input name="progress" type="checkbox" ${screen.presentation.progress ? 'checked' : ''}> Playlist countdown</label>
    <label><input name="logo" type="checkbox" ${burn.logo ? 'checked' : ''}> Logo rest</label>
    <label>Logo every minutes <input name="logoEveryMinutes" type="number" value="${burn.logoEveryMinutes}"></label>
    <label>Logo seconds <input name="logoSeconds" type="number" value="${burn.logoSeconds}"></label>
    ${mediaSelect('logoMediaId', burn.logoMediaId, state.mediaItems)}
    <label><input name="tone" type="checkbox" ${burn.tone ? 'checked' : ''}> Tone shift</label>
    <label>Tone every minutes <input name="toneEveryMinutes" type="number" value="${burn.toneEveryMinutes}"></label>
    <label>Fade seconds <input name="toneFadeSeconds" type="number" value="${burn.toneFadeSeconds}"></label>
    <label>Hold seconds <input name="toneHoldSeconds" type="number" value="${burn.toneHoldSeconds}"></label>
    ${brandingFields(draft.branding, state.mediaItems)}
    ${templateFields(state)}
    <div class="row"><button class="primary" data-action="publish" type="button">Publish</button><button data-action="revert" type="button">Revert draft</button>${screen.template === 'award' ? '<button data-action="history" type="button">Move current honoree to history</button>' : ''}<button data-action="burn-logo" type="button">Preview logo rest</button><button data-action="burn-tone" type="button">Preview tone shift</button></div>
    <p class="muted">Published version ${screen.version}. The TV keeps the last good page if the Pi is briefly unreachable.</p>`
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

function brandingFields(branding = {}, mediaItems) {
  return `<h3>Branding</h3><label>Agency <input name="agencyName" value="${escapeAttr(branding.agencyName || '')}"></label><label>Sheriff line <input name="sheriffLine" value="${escapeAttr(branding.sheriffLine || '')}"></label><label>Primary <input name="primary" value="${escapeAttr(branding.primary || '')}"></label><label>Accent <input name="accent" value="${escapeAttr(branding.accent || '')}"></label>${mediaSelect('sealMediaId', branding.sealMediaId, mediaItems, 'Seal')}${mediaSelect('badgeMediaId', branding.badgeMediaId, mediaItems, 'Badge')}`
}
function mediaSelect(name, value, items, label = 'Logo') {
  return `<label>${label} <select name="${name}"><option value="">None</option>${items.map((item) => `<option value="${item.id}" ${item.id === value ? 'selected' : ''}>${escapeHtml(item.filename)}</option>`).join('')}</select></label>`
}
function templateFields(state) {
  const screen = state.screen
  if (screen.template === 'award') {
    const current = screen.draft.current || {}
    return `<h3>Current honoree</h3><label>Title <input name="title" value="${escapeAttr(screen.draft.title || '')}"></label><label>Name <input name="honoreeName" value="${escapeAttr(current.name || '')}"></label><label>Badge <input name="badgeNumber" value="${escapeAttr(current.badgeNumber || '')}"></label><label>Year <input name="awardYear" value="${escapeAttr(current.awardYear || '')}"></label><label>Rank <input name="rank" value="${escapeAttr(current.rank || '')}"></label><label>Hire date <input name="hireDate" value="${escapeAttr(current.hireDate || '')}"></label><label>Years of service <input name="yearsOfService" value="${escapeAttr(current.yearsOfService || '')}"></label>${mediaSelect('photoId', current.photoId, state.mediaItems, 'Photo')}`
  }
  if (screen.template === 'directory') return `<h3>Directory</h3><label>Title <input name="title" value="${escapeAttr(screen.draft.title || '')}"></label>${rowsEditor(state.dataset?.rows || [], ['name', 'subtitle', 'phone', 'details'], state.mediaItems)}<label>CSV import <textarea name="csv" placeholder="name,subtitle,phone,details"></textarea></label><label><input name="replace" type="checkbox"> Replace rows missing from the file</label><button data-action="import" type="button">Import CSV</button><button data-action="add-row" type="button">Add card</button>`
  if (screen.template === 'slides') return `<h3>Slides</h3>${(state.dataset?.rows || []).map((slide, index) => `<fieldset draggable="true" data-slide="${index}"><label>Title <input data-field="title" value="${escapeAttr(slide.title || '')}"></label><label>Text <div class="tiptap" contenteditable="true" data-html="${index}">${slide.bodyHtml || ''}</div></label><label>QR URL <input data-field="qrUrl" value="${escapeAttr(slide.qrUrl || '')}"></label><label>QR caption <input data-field="qrLabel" value="${escapeAttr(slide.qrLabel || '')}"></label><label>Seconds <input data-field="durationSec" type="number" value="${slide.durationSec || 12}"></label><label>Days <input data-field="days" value="${(slide.days || []).join(',')}" placeholder="0-6, blank is every day"></label><label>Start <input data-field="startTime" value="${escapeAttr(slide.startTime || '')}" placeholder="09:00"></label><label>End <input data-field="endTime" value="${escapeAttr(slide.endTime || '')}" placeholder="17:00"></label>${mediaSelect(`slideImage-${index}`, slide.imageId, state.mediaItems, 'Image')}</fieldset>`).join('')}<button data-action="add-slide" type="button">Add slide</button>`
  const family = screen.mode.family
  const choices = (state.allScreens || []).filter((item) => item.id !== screen.id && item.template !== 'playlist' && item.mode.family === family)
  return `<h3>Playlist</h3><p class="muted">Only screens in the ${escapeHtml(family)} family are listed.</p>${(screen.draft.entries || []).map((entry, index) => `<fieldset draggable="true" data-entry="${index}"><label>Screen <select data-field="screenId">${choices.map((item) => `<option value="${item.id}" ${item.id === entry.screenId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label>Seconds <input data-field="durationSec" type="number" value="${entry.durationSec || 15}"></label><label>Days <input data-field="days" value="${(entry.days || []).join(',')}"></label><label>Start <input data-field="startTime" value="${escapeAttr(entry.startTime || '')}"></label><label>End <input data-field="endTime" value="${escapeAttr(entry.endTime || '')}"></label></fieldset>`).join('')}<button data-action="add-entry" type="button">Add screen</button>`
}

function rowsEditor(rows, fields, mediaItems) {
  return `<table>${rows.map((row, index) => `<tr data-row="${index}">${fields.map((field) => `<td><input data-field="${field}" value="${escapeAttr(row[field] || '')}"></td>`).join('')}<td>${mediaSelect(`logo-${index}`, row.logoId, mediaItems, 'Logo')}</td></tr>`).join('')}</table>`
}

function readForm(form, state) {
  const data = new FormData(form)
  const screen = state.screen
  screen.name = data.get('name') || screen.name
  screen.turn = data.get('turn') || screen.turn
  const mode = state.modes.find((item) => item.id === data.get('modeId'))
  if (mode) screen.mode = mode
  screen.presentation.motion = data.get('motion')
  screen.presentation.listOverflow = data.get('listOverflow')
  screen.presentation.scrollSecondsPerRow = Number(data.get('scrollSecondsPerRow') || 12)
  screen.presentation.showClock = data.get('showClock') === 'on'
  screen.presentation.showWeather = data.get('showWeather') === 'on'
  screen.presentation.progress = data.get('progress') === 'on'
  screen.presentation.burnIn.logo = data.get('logo') === 'on'
  screen.presentation.burnIn.tone = data.get('tone') === 'on'
  screen.presentation.burnIn.logoEveryMinutes = Number(data.get('logoEveryMinutes') || 30)
  screen.presentation.burnIn.logoSeconds = Number(data.get('logoSeconds') || 8)
  screen.presentation.burnIn.logoMediaId = data.get('logoMediaId') || null
  screen.presentation.burnIn.toneEveryMinutes = Number(data.get('toneEveryMinutes') || 60)
  screen.presentation.burnIn.toneFadeSeconds = Number(data.get('toneFadeSeconds') || 30)
  screen.presentation.burnIn.toneHoldSeconds = Number(data.get('toneHoldSeconds') || 45)
  if (screen.draft.branding) {
    screen.draft.branding.agencyName = data.get('agencyName') || screen.draft.branding.agencyName
    screen.draft.branding.sheriffLine = data.get('sheriffLine') || ''
    screen.draft.branding.primary = data.get('primary') || screen.draft.branding.primary
    screen.draft.branding.accent = data.get('accent') || screen.draft.branding.accent
    screen.draft.branding.sealMediaId = data.get('sealMediaId') || null
    screen.draft.branding.badgeMediaId = data.get('badgeMediaId') || null
  }
  if (screen.template === 'award') {
    screen.draft.title = data.get('title') || ''
    screen.draft.current = { ...(screen.draft.current || {}), name: data.get('honoreeName') || '', badgeNumber: data.get('badgeNumber') || '', awardYear: data.get('awardYear') || '', rank: data.get('rank') || '', hireDate: data.get('hireDate') || '', yearsOfService: data.get('yearsOfService') || '', photoId: data.get('photoId') || null }
  }
  if (data.get('modeId') === 'custom') screen.mode = { width: Number(data.get('customWidth') || screen.mode.width), height: Number(data.get('customHeight') || screen.mode.height) }
  if (screen.template === 'directory' && state.dataset) {
    screen.draft.title = data.get('title') || ''
    form.querySelectorAll('tr[data-row]').forEach((row) => {
      const item = state.dataset.rows[Number(row.dataset.row)]
      if (!item) return
      row.querySelectorAll('[data-field]').forEach((input) => { item[input.dataset.field] = input.value })
      item.logoId = row.querySelector('select')?.value || null
    })
  }
  if (screen.template === 'slides' && state.dataset) {
    state.dataset.rows = [...form.querySelectorAll('fieldset[data-slide]')].map((field) => {
      const index = Number(field.dataset.slide)
      const item = { ...(state.dataset.rows[index] || { id: crypto.randomUUID() }) }
      field.querySelectorAll('[data-field]').forEach((input) => {
        if (input.dataset.field === 'days') item.days = input.value.split(',').map((part) => Number(part.trim())).filter((part) => part >= 0 && part <= 6)
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
        if (input.dataset.field === 'days') item.days = input.value.split(',').map((part) => Number(part.trim())).filter((part) => part >= 0 && part <= 6)
        else if (input.dataset.field === 'durationSec') item.durationSec = Number(input.value || 15)
        else item[input.dataset.field] = input.value
      })
      return item
    })
  }
  const frame = document.querySelector('#preview')
  if (frame) { frame.dataset.width = screen.mode.width; frame.dataset.height = screen.mode.height }
}

let saveTimer = 0
function queueSave(state) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(state), 400)
}
async function save(state) {
  state.screen = await api(`/api/screens/${state.screen.id}`, { method: 'PUT', body: JSON.stringify({ name: state.screen.name, mode: state.screen.mode, turn: state.screen.turn, presentation: state.screen.presentation, draft: state.screen.draft }) })
  if (state.dataset) await api(`/api/datasets/${state.dataset.id}`, { method: 'PUT', body: JSON.stringify({ rows: state.dataset.rows, source: state.dataset.source, sourceUrl: state.dataset.sourceUrl }) })
  document.querySelector('#preview')?.contentWindow?.postMessage({ type: 'signage-refresh' }, location.origin)
  fitPreview()
}
function setPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]]
  cursor[parts.at(-1)] = value
}
function addRow(state) {
  state.dataset.rows.push({ id: crypto.randomUUID(), name: 'New card', subtitle: '', phone: '', details: '', logoId: null })
}
function addSlide(state) {
  state.dataset.rows.push({ id: crypto.randomUUID(), title: 'Announcement', bodyHtml: '<p></p>', qrUrl: '', qrLabel: '', imageId: null, durationSec: 12, days: [], startTime: '', endTime: '' })
}
function addEntry(state) {
  state.screen.draft.entries.push({ id: crypto.randomUUID(), screenId: '', durationSec: 15, days: [], startTime: '', endTime: '' })
}

async function datasets() {
  const rows = await api('/api/datasets')
  shell('datasets', `<h1>Datasets</h1>${rows.map((item) => `<article class="cardish"><h2>${escapeHtml(item.name)}</h2><p>${item.kind} · ${item.rows.length} rows · ${item.source}</p>${item.lastError ? `<p class="warn">${escapeHtml(item.lastError)}</p>` : ''}<form data-id="${item.id}" class="row"><input name="sourceUrl" value="${escapeAttr(item.sourceUrl || '')}" placeholder="http://10.0.0.5/cards.json"><button>Pull from LAN</button></form></article>`).join('')}`)
  document.querySelectorAll('form[data-id]').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault()
      const id = form.dataset.id
      await api(`/api/datasets/${id}`, { method: 'PUT', body: JSON.stringify({ source: 'lan-http', sourceUrl: new FormData(form).get('sourceUrl') }) })
      await api(`/api/datasets/${id}/fetch`, { method: 'POST', body: '{}' })
      datasets()
    }
  })
}

async function media() {
  const items = await api('/api/media')
  shell('media', `<h1>Media</h1><form id="upload" class="row"><select name="folder"><option>photos</option><option>seals</option><option>logos</option></select><input name="file" type="file" accept="image/*" required><button class="primary">Upload</button></form><p class="warn" id="err"></p><div class="grid">${items.map((item) => `<article class="cardish"><img src="/media/${item.id}" alt="" style="width:100%;height:140px;object-fit:cover"><p>${escapeHtml(item.filename)}</p><button data-id="${item.id}" type="button">Delete</button></article>`).join('')}</div>`)
  document.querySelector('#upload').onsubmit = async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try { await fetch('/api/media', { method: 'POST', body: data, credentials: 'same-origin' }).then(async (response) => { if (!response.ok) throw new Error((await response.json()).error) }); media() }
    catch (error) { document.querySelector('#err').textContent = error.message }
  }
  document.querySelectorAll('button[data-id]').forEach((button) => { button.onclick = async () => { await api(`/api/media/${button.dataset.id}`, { method: 'DELETE' }); media() } })
}

async function settings() {
  const [agency, override, users, screens] = await Promise.all([api('/api/agency'), api('/api/override'), me.role === 'admin' ? api('/api/users') : [], api('/api/screens')])
  shell('settings', `<h1>Settings</h1>
    <form id="agency" class="cardish"><h2>Agency</h2><label>Timezone <input name="timezone" value="${escapeAttr(agency.timezone)}"></label><label>Weather latitude <input name="weatherLat" value="${agency.weatherLat ?? ''}"></label><label>Weather longitude <input name="weatherLon" value="${agency.weatherLon ?? ''}"></label><button class="primary">Save</button></form>
    <form id="override" class="cardish"><h2>Priority override</h2><label><input name="active" type="checkbox" ${override.active ? 'checked' : ''}> Active</label><label>Title <input name="title" value="${escapeAttr(override.title)}"></label><label>Body <textarea name="body">${escapeHtml(override.body)}</textarea></label><label>Screen <select name="screenId"><option value="">Message only</option>${screens.filter((screen) => screen.template !== 'playlist').map((screen) => `<option value="${screen.id}" ${screen.id === override.screenId ? 'selected' : ''}>${escapeHtml(screen.name)}</option>`).join('')}</select></label><button class="primary">Save override</button></form>
    <form id="password" class="cardish"><h2>Your password</h2><input name="password" type="password" minlength="8" required><button>Change password</button></form>
    ${me.role === 'admin' ? `<form id="user" class="cardish"><h2>Users</h2>${users.map((user) => `<p>${escapeHtml(user.username)} · ${user.role} ${user.id === me.id ? '' : `<button data-user="${user.id}" type="button">Remove</button>`}</p>`).join('')}<div class="row"><input name="username" placeholder="username" required><input name="password" type="password" minlength="8" required><select name="role"><option value="editor">editor</option><option value="admin">admin</option></select><button>Add user</button></div></form><div class="cardish"><h2>Backup</h2><p><a href="/api/admin/backup">Download database and media</a></p><form id="restore"><input name="file" type="file" accept=".zip" required><button>Restore</button></form><p id="restore-msg"></p></div>` : ''}`)
  document.querySelector('#agency').onsubmit = async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); data.weatherLat = data.weatherLat === '' ? null : Number(data.weatherLat); data.weatherLon = data.weatherLon === '' ? null : Number(data.weatherLon); await api('/api/agency', { method: 'PUT', body: JSON.stringify(data) }) }
  document.querySelector('#override').onsubmit = async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); data.active = new FormData(event.target).get('active') === 'on'; await api('/api/override', { method: 'PUT', body: JSON.stringify(data) }) }
  document.querySelector('#password').onsubmit = async (event) => { event.preventDefault(); await api('/api/me/password', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) }) }
  const userForm = document.querySelector('#user')
  if (userForm) {
    userForm.onsubmit = async (event) => { event.preventDefault(); await api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(userForm))) }); settings() }
    userForm.querySelectorAll('[data-user]').forEach((button) => { button.onclick = async () => { await api(`/api/users/${button.dataset.user}`, { method: 'DELETE' }); settings() } })
  }
  const restore = document.querySelector('#restore')
  if (restore) restore.onsubmit = async (event) => {
    event.preventDefault()
    const data = new FormData(restore)
    const response = await fetch('/api/admin/restore', { method: 'POST', body: data, credentials: 'same-origin' })
    document.querySelector('#restore-msg').textContent = response.ok ? 'Backup restored.' : 'Restore failed.'
  }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;') }
