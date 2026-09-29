import { isActiveNow } from '../shared/schedule'
import type {
  AwardDraft,
  CardItem,
  DatasetRecord,
  DirectoryDraft,
  Honoree,
  OverrideView,
  PlaylistDraft,
  PlaylistFrame,
  PublicPayload,
  ScreenRecord,
  SlideItem,
  SlidesDraft,
  WeatherReading,
} from '../shared/types'
import { brandingDefaults } from '../shared/defaults'
import type { DatasetRow, ScreenRow } from './db'

export function parseScreen(row: ScreenRow): ScreenRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    template: row.template,
    mode: JSON.parse(row.mode_json),
    turn: row.turn,
    presentation: JSON.parse(row.presentation_json),
    datasetId: row.dataset_id,
    draft: JSON.parse(row.draft_json),
    published: row.published_json ? JSON.parse(row.published_json) : null,
    version: row.version,
    loadCount: row.load_count,
  }
}

export function parseDataset(row: DatasetRow): DatasetRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    rows: JSON.parse(row.rows_json),
    source: row.source,
    sourceUrl: row.source_url,
    intervalSec: row.interval_sec,
    lastFetch: row.last_fetch,
    lastError: row.last_error,
  }
}

export function buildPayload(options: {
  screen: ScreenRecord
  source: 'draft' | 'published'
  datasetRows: unknown[]
  allScreens: ScreenRecord[]
  datasets: Map<string, unknown[]>
  now: Date
  timezone: string
  weather: WeatherReading | null
  override: { active: boolean; title: string; body: string; screenId: string | null }
  depth?: number
}): PublicPayload {
  const { screen, source, now, timezone } = options
  const content = source === 'draft' ? screen.draft : screen.published
  const branding = content && 'branding' in content ? content.branding : brandingDefaults()
  const weather = screen.presentation.showWeather ? options.weather : null
  const base: PublicPayload = {
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
    empty: !content || screen.version === 0 && source === 'published',
  }
  if (!content || (source === 'published' && screen.version === 0)) {
    base.empty = true
    return base
  }
  base.empty = false
  if (screen.template === 'award') {
    const draft = content as AwardDraft
    const history = (options.datasetRows as Honoree[]).slice().sort((a, b) => Number(b.awardYear) - Number(a.awardYear) || a.name.localeCompare(b.name))
    const currentBlank = !draft.current.name && !draft.current.photoId
    base.award = { title: draft.title, current: draft.current, history }
    base.empty = currentBlank && history.length === 0
    base.branding = draft.branding
  } else if (screen.template === 'directory') {
    const draft = content as DirectoryDraft
    const cards = (options.datasetRows as CardItem[]).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    base.directory = { title: draft.title, cards }
    base.empty = cards.length === 0
    base.branding = draft.branding
  } else if (screen.template === 'slides') {
    const draft = content as SlidesDraft
    const slides = (options.datasetRows as SlideItem[]).filter((slide) => isActiveNow(slide, now, timezone))
    base.slides = { slides }
    base.empty = slides.length === 0
    base.branding = draft.branding
  } else {
    const draft = content as PlaylistDraft
    const depth = options.depth ?? 0
    const family = screen.mode.family
    const entries: PlaylistFrame[] = []
    for (const entry of draft.entries) {
      if (!isActiveNow(entry, now, timezone)) continue
      const child = options.allScreens.find((item) => item.id === entry.screenId)
      if (!child || child.template === 'playlist') continue
      if (child.mode.family !== family) continue
      if (depth > 1) continue
      const childRows = child.datasetId ? options.datasets.get(child.datasetId) ?? [] : []
      const payload = buildPayload({
        ...options,
        screen: { ...child, mode: screen.mode },
        source: 'published',
        datasetRows: childRows,
        depth: depth + 1,
      })
      entries.push({ id: entry.id, durationSec: entry.durationSec, name: child.name, payload })
    }
    let overrideView: OverrideView | null = null
    if (options.override.active && depth === 0) {
      let payload: PublicPayload | null = null
      if (options.override.screenId) {
        const target = options.allScreens.find((item) => item.id === options.override.screenId)
        if (target && target.template !== 'playlist') {
          const rows = target.datasetId ? options.datasets.get(target.datasetId) ?? [] : []
          payload = buildPayload({
            ...options,
            screen: { ...target, mode: screen.mode },
            source: 'published',
            datasetRows: rows,
            depth: depth + 1,
            override: { ...options.override, active: false },
          })
        }
      }
      overrideView = { title: options.override.title, body: options.override.body, payload }
    }
    base.playlist = { entries, override: overrideView }
    base.empty = entries.length === 0 && !overrideView
    base.branding = draft.branding
  }
  return base
}
