import type { DisplayMode } from './modes'

export type Role = 'admin' | 'editor'
export type TemplateKind = 'award' | 'directory' | 'slides' | 'playlist'
export type DatasetKind = 'honorees' | 'cards' | 'slides'
export type Turn = 'none' | 'clockwise' | 'counterclockwise'
export type Motion = 'off' | 'subtle' | 'smooth'
export type Overflow = 'fit' | 'slow-scroll'
export type DatasetSource = 'manual' | 'lan-http'

export interface Branding {
  agencyName: string
  sheriffLine: string
  primary: string
  accent: string
  ink: string
  plate: string
  lightBg: string
  lightInk: string
  badgeMediaId: string | null
  sealMediaId: string | null
}

export interface Honoree {
  id: string
  name: string
  badgeNumber: string
  awardYear: string
}

export interface CurrentHonoree {
  name: string
  badgeNumber: string
  awardYear: string
  rank: string
  hireDate: string
  yearsOfService: string
  photoId: string | null
}

export interface AwardDraft {
  title: string
  branding: Branding
  current: CurrentHonoree
}

export interface CardItem {
  id: string
  name: string
  subtitle: string
  phone: string
  details: string
  logoId: string | null
}

export interface DirectoryDraft {
  title: string
  branding: Branding
}

export interface SlideItem {
  id: string
  kind: 'text' | 'image' | 'mixed'
  title: string
  bodyHtml: string
  qrUrl: string
  qrLabel: string
  imageId: string | null
  durationSec: number
  days: number[]
  startTime: string
  endTime: string
}

export interface SlidesDraft {
  branding: Branding
}

export interface PlaylistEntry {
  id: string
  screenId: string
  durationSec: number
  days: number[]
  startTime: string
  endTime: string
}

export interface PlaylistDraft {
  branding: Branding
  entries: PlaylistEntry[]
}

export type ScreenDraft = AwardDraft | DirectoryDraft | SlidesDraft | PlaylistDraft

export interface BurnInSettings {
  logo: boolean
  logoEveryMinutes: number
  logoSeconds: number
  logoMediaId: string | null
  tone: boolean
  toneEveryMinutes: number
  toneFadeSeconds: number
  toneHoldSeconds: number
}

export interface Presentation {
  motion: Motion
  listOverflow: Overflow
  scrollSecondsPerRow: number
  burnIn: BurnInSettings
  showClock: boolean
  showWeather: boolean
  progress: boolean
}

export interface WeatherReading {
  tempF: number
  condition: string
  observedAt: string
}

export interface PublicPayload {
  slug: string
  name: string
  version: number
  serverNow: string
  timezone: string
  template: TemplateKind
  mode: DisplayMode
  turn: Turn
  presentation: Presentation
  weather: WeatherReading | null
  branding: Branding
  empty: boolean
  award?: { title: string; current: CurrentHonoree; history: Honoree[] }
  directory?: { title: string; cards: CardItem[] }
  slides?: { slides: SlideItem[] }
  playlist?: {
    entries: PlaylistFrame[]
    override: OverrideView | null
  }
}

export interface PlaylistFrame {
  id: string
  durationSec: number
  name: string
  payload: PublicPayload
}

export interface OverrideView {
  title: string
  body: string
  payload: PublicPayload | null
}

export interface ScreenRecord {
  id: string
  slug: string
  name: string
  template: TemplateKind
  mode: DisplayMode
  turn: Turn
  presentation: Presentation
  datasetId: string | null
  draft: ScreenDraft
  published: ScreenDraft | null
  version: number
  loadCount: number
}

export interface DatasetRecord {
  id: string
  name: string
  kind: DatasetKind
  rows: unknown[]
  source: DatasetSource
  sourceUrl: string
  intervalSec: number
  lastFetch: string | null
  lastError: string | null
}
