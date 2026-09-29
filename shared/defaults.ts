import type { Branding, BurnInSettings, Presentation, TemplateKind } from './types'

export function brandingDefaults(): Branding {
  return {
    agencyName: 'Agency',
    sheriffLine: 'Sheriff',
    primary: '#0c2340',
    accent: '#c4a35a',
    ink: '#f4efe4',
    plate: '#f3e6c4',
    lightBg: '#f6f1e6',
    lightInk: '#0c2340',
    badgeMediaId: null,
    sealMediaId: null,
  }
}

export function burnInDefaults(): BurnInSettings {
  return {
    logo: false,
    logoEveryMinutes: 30,
    logoSeconds: 8,
    logoMediaId: null,
    tone: false,
    toneEveryMinutes: 60,
    toneFadeSeconds: 30,
    toneHoldSeconds: 45,
  }
}

export function presentationDefaults(template: TemplateKind): Presentation {
  return {
    motion: 'subtle',
    listOverflow: template === 'award' ? 'slow-scroll' : 'fit',
    scrollSecondsPerRow: 12,
    burnIn: burnInDefaults(),
    showClock: false,
    showWeather: false,
    progress: template === 'playlist',
  }
}

export function emptyDraft(template: TemplateKind) {
  const branding = brandingDefaults()
  if (template === 'award') {
    return {
      title: 'Patrol Deputy of the Year',
      branding,
      current: {
        name: '',
        badgeNumber: '',
        awardYear: '',
        rank: '',
        hireDate: '',
        yearsOfService: '',
        photoId: null,
      },
    }
  }
  if (template === 'directory') {
    return { title: 'Bonding Companies', branding }
  }
  if (template === 'slides') {
    return { branding }
  }
  return { branding, entries: [] }
}

export function datasetKindFor(template: TemplateKind): 'honorees' | 'cards' | 'slides' | null {
  if (template === 'award') return 'honorees'
  if (template === 'directory') return 'cards'
  if (template === 'slides') return 'slides'
  return null
}
