import type { CardItem } from './types'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if (char === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (char !== '\r') cell += char
  }
  if (cell.length || row.length) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows.filter((item) => item.some((value) => value.length > 0))
}

export function cardsFromCsv(text: string, existing: CardItem[], replace: boolean): CardItem[] {
  const table = parseCsv(text)
  if (table.length === 0) return replace ? [] : existing
  const header = table[0].map((value) => value.toLowerCase())
  const hasHeader = header.some((value) => ['name', 'subtitle', 'phone', 'details'].includes(value))
  const body = hasHeader ? table.slice(1) : table
  const index = (key: string, fallback: number) => {
    const found = header.indexOf(key)
    return hasHeader && found >= 0 ? found : fallback
  }
  const nameI = index('name', 0)
  const subtitleI = index('subtitle', 1)
  const phoneI = index('phone', 2)
  const detailsI = index('details', 3)
  const next = replace ? [] : existing.map((item) => ({ ...item }))
  for (const cells of body) {
    const name = cells[nameI] || ''
    if (!name) continue
    const patch = {
      name,
      subtitle: cells[subtitleI] || '',
      phone: cells[phoneI] || '',
      details: cells[detailsI] || '',
    }
    const found = next.find((item) => item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
    if (found) {
      found.subtitle = patch.subtitle
      found.phone = patch.phone
      found.details = patch.details
    } else {
      next.push({ id: crypto.randomUUID(), ...patch, logoId: null })
    }
  }
  next.sort((a, b) => a.name.localeCompare(b.name))
  return next
}
