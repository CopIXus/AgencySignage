import { agencyRow, database } from './db'
import type { WeatherReading } from '../shared/types'

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
}

export function freshWeather(): WeatherReading | null {
  const row = agencyRow()
  if (!row.weather_json || !row.weather_at) return null
  const age = Date.now() - new Date(row.weather_at).getTime()
  if (age > 60 * 60 * 1000) return null
  return JSON.parse(row.weather_json) as WeatherReading
}

export async function refreshWeather(): Promise<void> {
  const row = agencyRow()
  if (row.weather_lat == null || row.weather_lon == null) return
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${row.weather_lat}&longitude=${row.weather_lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`Weather service returned ${response.status}`)
    const body = await response.json() as { current?: { temperature_2m?: number; weather_code?: number; time?: string } }
    const current = body.current
    if (!current || typeof current.temperature_2m !== 'number') throw new Error('Weather service returned no reading')
    const reading: WeatherReading = {
      tempF: Math.round(current.temperature_2m),
      condition: WEATHER_CODES[current.weather_code ?? -1] || 'Weather',
      observedAt: new Date().toISOString(),
    }
    database().prepare(`UPDATE agency SET weather_json = ?, weather_at = ?, weather_error = NULL WHERE id = 1`).run(JSON.stringify(reading), reading.observedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Weather unavailable'
    database().prepare('UPDATE agency SET weather_error = ? WHERE id = 1').run(message)
  }
}
