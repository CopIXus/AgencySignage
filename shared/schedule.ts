export interface Windowed {
  days: number[]
  startTime: string
  endTime: string
}

export function isActiveNow(item: Windowed, now: Date, timeZone: string): boolean {
  const parts = zonedParts(now, timeZone)
  if (item.days.length > 0 && !item.days.includes(parts.weekday)) return false
  if (!item.startTime && !item.endTime) return true
  const minutes = parts.hour * 60 + parts.minute
  const start = parseMinutes(item.startTime)
  const end = parseMinutes(item.endTime)
  if (start === null && end === null) return true
  if (start !== null && end !== null && start > end) {
    return minutes >= start || minutes < end
  }
  if (start !== null && minutes < start) return false
  if (end !== null && minutes >= end) return false
  return true
}

function parseMinutes(value: string): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function zonedParts(now: Date, timeZone: string): { weekday: number; hour: number; minute: number; year: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    hourCycle: 'h23',
  })
  const map = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    weekday: Math.max(0, weekdays.indexOf(map.weekday)),
    hour: Number(map.hour),
    minute: Number(map.minute),
    year: Number(map.year),
  }
}

export function clockLooksWrong(now: Date): boolean {
  const year = now.getFullYear()
  return year < 2024 || year > 2100
}
