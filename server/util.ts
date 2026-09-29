import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { database, databasePath, dataDir } from './db'

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  if (parts[0] === 10 || parts[0] === 127) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

export function lanAddresses(): string[] {
  const hosts = new Set<string>(['signage.local', 'localhost'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) hosts.add(item.address)
    }
  }
  return [...hosts]
}

export function diskFreeBytes(): number {
  try {
    return Number(fs.statfsSync(dataDir).bavail) * Number(fs.statfsSync(dataDir).bsize)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'screen'
}

export function uniqueSlug(base: string): string {
  let slug = slugify(base)
  let n = 2
  while (database().prepare('SELECT id FROM screens WHERE slug = ?').get(slug)) {
    slug = `${slugify(base)}-${n++}`
  }
  return slug
}

export function backupDatabase(): string {
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupDir, `signage-${stamp}.db`)
  database().exec('PRAGMA wal_checkpoint(FULL)')
  fs.copyFileSync(databasePath, target)
  const files = fs.readdirSync(backupDir).filter((name) => name.endsWith('.db')).sort()
  while (files.length > 7) {
    const oldest = files.shift()
    if (oldest) fs.rmSync(path.join(backupDir, oldest), { force: true })
  }
  const marker = path.join(dataDir, 'last-backup.txt')
  fs.writeFileSync(marker, new Date().toISOString())
  return target
}

export function maybeDailyBackup(): void {
  const marker = path.join(dataDir, 'last-backup.txt')
  const last = fs.existsSync(marker) ? Date.parse(fs.readFileSync(marker, 'utf8')) : 0
  if (Date.now() - last > 20 * 60 * 60 * 1000) backupDatabase()
}
