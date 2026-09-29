import { isActiveNow } from '../shared/runtime.js'

export function buildPayload(options) {
  const { screen, source, now, timezone } = options
  const content = source === 'draft' ? screen.draft : screen.published
  const branding = content?.branding || screen.draft?.branding
  const weather = screen.presentation.showWeather ? options.weather : null
  const base = {
    slug: screen.slug,
    name: screen.name,
    version: screen.version,
    serverNow: now.toISOString(),
    timezone,
    template: screen.template,
    mode: screen.mode,
    turn: screen.turn,
    presentation: screen.presentation,
    weather,
    branding,
    empty: true,
  }
  if (!content || (source === 'published' && screen.version === 0)) return base
  base.empty = false
  base.layout = content.layout && content.layout.enabled ? content.layout : null
  if (screen.template === 'award') {
    const history = [...(options.datasetRows || [])].sort((a, b) => Number(b.awardYear) - Number(a.awardYear) || a.name.localeCompare(b.name))
    base.award = { title: content.title, current: content.current, history }
    base.empty = !content.current?.name && !content.current?.photoId && history.length === 0
  } else if (screen.template === 'directory') {
    const cards = [...(options.datasetRows || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    base.directory = { title: content.title, cards }
    base.empty = cards.length === 0
  } else if (screen.template === 'slides') {
    const slides = (options.datasetRows || []).filter((slide) => isActiveNow(slide, now, timezone))
    base.slides = { slides }
    base.empty = slides.length === 0
  } else {
    const entries = []
    for (const entry of content.entries || []) {
      if (!isActiveNow(entry, now, timezone)) continue
      const child = options.allScreens.find((item) => item.id === entry.screenId)
      if (!child || child.template === 'playlist' || child.mode.family !== screen.mode.family) continue
      const payload = buildPayload({
        ...options,
        screen: { ...child, mode: screen.mode },
        source: 'published',
        datasetRows: child.datasetId ? options.datasets.get(child.datasetId) || [] : [],
        override: { ...options.override, active: false },
      })
      entries.push({ id: entry.id, durationSec: entry.durationSec, name: child.name, payload })
    }
    let override = null
    if (options.override.active) {
      let payload = null
      if (options.override.screenId) {
        const target = options.allScreens.find((item) => item.id === options.override.screenId)
        if (target && target.template !== 'playlist') {
          payload = buildPayload({
            ...options,
            screen: { ...target, mode: screen.mode },
            source: 'published',
            datasetRows: target.datasetId ? options.datasets.get(target.datasetId) || [] : [],
            override: { ...options.override, active: false },
          })
        }
      }
      override = { title: options.override.title, body: options.override.body, payload }
    }
    base.playlist = { entries, override }
    base.empty = entries.length === 0 && !override
  }
  return base
}
