export type AspectFamily = '16:9' | '16:10' | '4:3' | '9:16' | '10:16' | '3:4'

export interface DisplayMode {
  id: string
  label: string
  width: number
  height: number
  family: AspectFamily
}

const MAX_EDGE = 4096

function mode(width: number, height: number, label: string): DisplayMode {
  return {
    id: `${width}x${height}`,
    label: `${label} ${width}×${height}`,
    width,
    height,
    family: familyFor(width, height),
  }
}

export function familyFor(width: number, height: number): AspectFamily {
  const ratio = width / height
  const landscape = width >= height
  const abs = landscape ? ratio : 1 / ratio
  let base: '16:9' | '16:10' | '4:3'
  if (abs >= 1.7) base = '16:9'
  else if (abs >= 1.45) base = '16:10'
  else base = '4:3'
  if (landscape) return base
  if (base === '16:9') return '9:16'
  if (base === '16:10') return '10:16'
  return '3:4'
}

export function isWideFamily(family: AspectFamily): boolean {
  return family === '16:9' || family === '16:10' || family === '4:3'
}

export function isTightFamily(family: AspectFamily): boolean {
  return family === '4:3' || family === '3:4' || family === '16:10' || family === '10:16'
}

export const DISPLAY_MODES: DisplayMode[] = [
  mode(1280, 720, 'HD'),
  mode(1366, 768, 'WXGA'),
  mode(1600, 900, 'HD+'),
  mode(1920, 1080, 'Full HD'),
  mode(2560, 1440, 'QHD'),
  mode(3840, 2160, '4K UHD'),
  mode(4096, 2160, 'DCI 4K'),
  mode(1280, 800, 'WXGA'),
  mode(1440, 900, 'WXGA+'),
  mode(1680, 1050, 'WSXGA+'),
  mode(1920, 1200, 'WUXGA'),
  mode(2560, 1600, 'WQXGA'),
  mode(1024, 768, 'XGA'),
  mode(1600, 1200, 'UXGA'),
  mode(1920, 1440, '4:3'),
  mode(720, 1280, 'HD portrait'),
  mode(768, 1366, 'WXGA portrait'),
  mode(900, 1600, 'HD+ portrait'),
  mode(1080, 1920, 'Full HD portrait'),
  mode(1440, 2560, 'QHD portrait'),
  mode(2160, 3840, '4K portrait'),
  mode(2160, 4096, 'DCI 4K portrait'),
  mode(800, 1280, 'WXGA portrait'),
  mode(900, 1440, 'WXGA+ portrait'),
  mode(1050, 1680, 'WSXGA+ portrait'),
  mode(1200, 1920, 'WUXGA portrait'),
  mode(1600, 2560, 'WQXGA portrait'),
  mode(768, 1024, 'XGA portrait'),
  mode(1200, 1600, 'UXGA portrait'),
  mode(1440, 1920, '3:4'),
]

export function findMode(id: string): DisplayMode | undefined {
  return DISPLAY_MODES.find((item) => item.id === id)
}

export function customMode(width: number, height: number): DisplayMode {
  const w = clampEdge(width)
  const h = clampEdge(height)
  return {
    id: `custom-${w}x${h}`,
    label: `Custom ${w}×${h}`,
    width: w,
    height: h,
    family: familyFor(w, h),
  }
}

function clampEdge(value: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 1920
  return Math.max(640, Math.min(MAX_EDGE, n))
}

export function resolveMode(input: { id?: string; width?: number; height?: number }): DisplayMode {
  if (input.id && input.id !== 'custom') {
    const found = findMode(input.id)
    if (found) return found
  }
  if (input.width && input.height) return customMode(input.width, input.height)
  return findMode('1920x1080')!
}

export function closestMode(width: number, height: number): DisplayMode {
  let best = DISPLAY_MODES[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of DISPLAY_MODES) {
    const score = Math.abs(item.width - width) + Math.abs(item.height - height)
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

export function sameFamily(a: AspectFamily, b: AspectFamily): boolean {
  return a === b
}
