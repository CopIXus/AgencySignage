import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { brandingDefaults } from '../shared/defaults'
import type { DatasetKind, DatasetSource, Role, TemplateKind, Turn } from '../shared/types'

export const rootDir = path.resolve(import.meta.dirname, '..')
export const dataDir = path.join(rootDir, 'data')
export const mediaDir = path.join(dataDir, 'media')
export const backupDir = path.join(dataDir, 'backups')
export const certDir = path.join(dataDir, 'certs')
export const databasePath = path.join(dataDir, 'signage.db')

let db: DatabaseSync

export function openDatabase(): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })
  fs.mkdirSync(certDir, { recursive: true })
  db = new DatabaseSync(databasePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agency (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      timezone TEXT NOT NULL,
      weather_lat REAL,
      weather_lon REAL,
      weather_json TEXT,
      weather_at TEXT,
      weather_error TEXT
    );
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      interval_sec INTEGER NOT NULL DEFAULT 300,
      last_fetch TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS screens (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      mode_json TEXT NOT NULL,
      turn TEXT NOT NULL,
      presentation_json TEXT NOT NULL,
      dataset_id TEXT,
      draft_json TEXT NOT NULL,
      published_json TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      load_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      screen_slug TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      reported_version INTEGER,
      width INTEGER,
      height INTEGER,
      dpr REAL
    );
    CREATE TABLE IF NOT EXISTS enroll_tokens (
      token TEXT PRIMARY KEY,
      screen_id TEXT,
      device_name TEXT NOT NULL,
      restart_time TEXT NOT NULL,
      turn TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS publishes (
      id TEXT PRIMARY KEY,
      screen_id TEXT NOT NULL,
      user_id TEXT,
      username TEXT NOT NULL,
      version INTEGER NOT NULL,
      published_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      folder TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS overrides (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      screen_id TEXT
    );
  `)
  const agency = db.prepare('SELECT id FROM agency WHERE id = 1').get()
  if (!agency) {
    db.prepare('INSERT INTO agency (id, timezone) VALUES (1, ?)').run('America/Detroit')
  }
  const override = db.prepare('SELECT id FROM overrides WHERE id = 1').get()
  if (!override) db.prepare('INSERT INTO overrides (id, active) VALUES (1, 0)').run()
  return db
}

export function database(): DatabaseSync {
  return db
}

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: Role
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
}

export function getUser(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function listUsers(): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY username').all() as UserRow[]
}

export interface ScreenRow {
  id: string
  slug: string
  name: string
  template: TemplateKind
  mode_json: string
  turn: Turn
  presentation_json: string
  dataset_id: string | null
  draft_json: string
  published_json: string | null
  version: number
  load_count: number
  created_at: string
  updated_at: string
}

export function listScreens(): ScreenRow[] {
  return db.prepare('SELECT * FROM screens ORDER BY name').all() as ScreenRow[]
}

export function getScreen(id: string): ScreenRow | undefined {
  return db.prepare('SELECT * FROM screens WHERE id = ?').get(id) as ScreenRow | undefined
}

export function getScreenBySlug(slug: string): ScreenRow | undefined {
  return db.prepare('SELECT * FROM screens WHERE slug = ?').get(slug) as ScreenRow | undefined
}

export interface DatasetRow {
  id: string
  name: string
  kind: DatasetKind
  rows_json: string
  source: DatasetSource
  source_url: string
  interval_sec: number
  last_fetch: string | null
  last_error: string | null
}

export function listDatasets(): DatasetRow[] {
  return db.prepare('SELECT * FROM datasets ORDER BY name').all() as DatasetRow[]
}

export function getDataset(id: string): DatasetRow | undefined {
  return db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as DatasetRow | undefined
}

export function agencyRow() {
  return db.prepare('SELECT * FROM agency WHERE id = 1').get() as {
    timezone: string
    weather_lat: number | null
    weather_lon: number | null
    weather_json: string | null
    weather_at: string | null
    weather_error: string | null
  }
}

export function defaultBrandingJson(): string {
  return JSON.stringify(brandingDefaults())
}
