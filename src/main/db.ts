import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import type { ChatMessage, GameFilter, GameRecord, GameReview, ParsedGame, PositionAnalysis } from '@shared/types'

/**
 * Local persistence (SQLite via Node's built-in driver — no native module to compile or ship).
 * Schema changes are append-only migrations keyed on PRAGMA user_version.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    white TEXT NOT NULL, black TEXT NOT NULL,
    white_elo TEXT, black_elo TEXT,
    result TEXT NOT NULL, date TEXT, event TEXT, site TEXT, time_control TEXT,
    eco TEXT, opening TEXT,
    source TEXT NOT NULL, source_url TEXT,
    pgn TEXT NOT NULL, pgn_hash TEXT NOT NULL UNIQUE,
    ply_count INTEGER NOT NULL,
    folder TEXT, tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX games_created ON games(created_at DESC);
  CREATE INDEX games_folder ON games(folder);
  CREATE INDEX games_players ON games(white, black);
  CREATE TABLE reviews (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    preset TEXT NOT NULL, accuracy_white REAL, accuracy_black REAL,
    data TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE analysis_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    coach_id TEXT NOT NULL, position_key TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX messages_game ON messages(game_id, id);
  CREATE TABLE explanations (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    coach_id TEXT NOT NULL, position_key TEXT NOT NULL, model TEXT NOT NULL,
    text TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (game_id, coach_id, position_key)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `
]

interface GameRow {
  id: number
  white: string
  black: string
  white_elo: string | null
  black_elo: string | null
  result: string
  date: string | null
  event: string | null
  site: string | null
  time_control: string | null
  eco: string | null
  opening: string | null
  source: string
  source_url: string | null
  pgn: string
  ply_count: number
  folder: string | null
  tags: string
  created_at: string
  has_review: number
  accuracy_white: number | null
  accuracy_black: number | null
}

const GAME_SELECT = `
  SELECT g.*, r.game_id IS NOT NULL AS has_review, r.accuracy_white, r.accuracy_black
  FROM games g LEFT JOIN reviews r ON r.game_id = g.id`

function toRecord(r: GameRow): GameRecord {
  let tags: string[] = []
  try {
    tags = JSON.parse(r.tags) as string[]
  } catch {
    tags = []
  }
  return {
    id: r.id,
    white: r.white,
    black: r.black,
    whiteElo: r.white_elo,
    blackElo: r.black_elo,
    result: r.result,
    date: r.date,
    event: r.event,
    site: r.site,
    timeControl: r.time_control,
    eco: r.eco,
    opening: r.opening,
    source: r.source as GameRecord['source'],
    sourceUrl: r.source_url,
    pgn: r.pgn,
    plyCount: r.ply_count,
    folder: r.folder,
    tags,
    createdAt: r.created_at,
    hasReview: !!r.has_review,
    accuracyWhite: r.accuracy_white,
    accuracyBlack: r.accuracy_black
  }
}

export class Database {
  private db: DatabaseSync

  constructor(private readonly file: string) {
    this.db = this.open()
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN')
      try {
        db.exec(MIGRATIONS[v])
        db.exec(`PRAGMA user_version = ${v + 1}`)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
    return db
  }

  get schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  }

  close(): void {
    this.db.close()
  }

  // ----- games -----

  /** Insert a game; returns the existing record (inserted=false) when the same PGN is already stored. */
  addGame(
    game: ParsedGame,
    meta: { source: GameRecord['source']; sourceUrl?: string | null; eco?: string | null; opening?: string | null }
  ): { record: GameRecord; inserted: boolean } {
    const hash = createHash('sha256').update(game.plies.map((p) => p.uci).join(' ') + '|' + (game.headers.White ?? '') + '|' + (game.headers.Black ?? '') + '|' + (game.headers.Date ?? '') + '|' + (game.headers.UTCTime ?? game.headers.StartTime ?? '')).digest('hex')
    const existing = this.db.prepare(`${GAME_SELECT} WHERE g.pgn_hash = ?`).get(hash) as GameRow | undefined
    if (existing) return { record: toRecord(existing), inserted: false }
    const h = game.headers
    const info = this.db
      .prepare(
        `INSERT INTO games (white, black, white_elo, black_elo, result, date, event, site, time_control, eco, opening, source, source_url, pgn, pgn_hash, ply_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        h.White ?? 'White',
        h.Black ?? 'Black',
        h.WhiteElo ?? null,
        h.BlackElo ?? null,
        game.result,
        h.UTCDate ?? h.Date ?? null,
        h.Event ?? null,
        h.Site ?? null,
        h.TimeControl ?? null,
        meta.eco ?? h.ECO ?? null,
        meta.opening ?? h.Opening ?? null,
        meta.source,
        meta.sourceUrl ?? h.Link ?? null,
        game.pgn,
        hash,
        game.plies.length,
        new Date().toISOString()
      )
    return { record: this.getGame(Number(info.lastInsertRowid))!, inserted: true }
  }

  getGame(id: number): GameRecord | null {
    const row = this.db.prepare(`${GAME_SELECT} WHERE g.id = ?`).get(id) as GameRow | undefined
    return row ? toRecord(row) : null
  }

  listGames(filter: GameFilter = {}, limit = 500): GameRecord[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.search) {
      where.push('(g.white LIKE ? OR g.black LIKE ? OR g.event LIKE ? OR g.opening LIKE ? OR g.date LIKE ?)')
      const q = `%${filter.search}%`
      args.push(q, q, q, q, q)
    }
    if (filter.folder !== undefined) {
      if (filter.folder === null) where.push('g.folder IS NULL')
      else {
        where.push('g.folder = ?')
        args.push(filter.folder)
      }
    }
    if (filter.result) {
      where.push('g.result = ?')
      args.push(filter.result)
    }
    if (filter.source) {
      where.push('g.source = ?')
      args.push(filter.source)
    }
    if (filter.tag) {
      where.push(`EXISTS (SELECT 1 FROM json_each(g.tags) WHERE json_each.value = ?)`)
      args.push(filter.tag)
    }
    const sql = `${GAME_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.created_at DESC, g.id DESC LIMIT ?`
    return (this.db.prepare(sql).all(...args, limit) as unknown as GameRow[]).map(toRecord)
  }

  updateGame(id: number, patch: { folder?: string | null; tags?: string[] }): GameRecord | null {
    if (patch.folder !== undefined) this.db.prepare('UPDATE games SET folder = ? WHERE id = ?').run(patch.folder || null, id)
    if (patch.tags !== undefined) {
      const tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))]
      this.db.prepare('UPDATE games SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id)
    }
    return this.getGame(id)
  }

  deleteGame(id: number): void {
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id)
  }

  deleteAllGames(): void {
    this.db.exec('DELETE FROM games; DELETE FROM analysis_cache;')
  }

  folders(): string[] {
    return (this.db.prepare('SELECT DISTINCT folder FROM games WHERE folder IS NOT NULL ORDER BY folder').all() as { folder: string }[]).map((r) => r.folder)
  }

  tags(): string[] {
    return (this.db.prepare('SELECT DISTINCT json_each.value AS tag FROM games, json_each(games.tags) ORDER BY tag').all() as { tag: string }[]).map((r) => r.tag)
  }

  stats(): { games: number; reviewed: number; avgAccuracy: number | null } {
    const g = this.db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }
    return { games: g.n, reviewed: r.n, avgAccuracy: null }
  }

  // ----- reviews -----

  saveReview(gameId: number, review: GameReview): void {
    this.db
      .prepare(
        `INSERT INTO reviews (game_id, preset, accuracy_white, accuracy_black, data, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET preset = excluded.preset, accuracy_white = excluded.accuracy_white,
           accuracy_black = excluded.accuracy_black, data = excluded.data, created_at = excluded.created_at`
      )
      .run(gameId, review.presetId, review.accuracy.white, review.accuracy.black, JSON.stringify(review), review.createdAt)
    // Explanations were written about the old analysis; they must not outlive it.
    this.db.prepare('DELETE FROM explanations WHERE game_id = ?').run(gameId)
  }

  getReview(gameId: number): GameReview | null {
    const row = this.db.prepare('SELECT data FROM reviews WHERE game_id = ?').get(gameId) as { data: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.data) as GameReview
    } catch {
      return null
    }
  }

  // ----- engine cache -----

  cacheGet(key: string): PositionAnalysis | null {
    const row = this.db.prepare('SELECT data FROM analysis_cache WHERE key = ?').get(key) as { data: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.data) as PositionAnalysis
    } catch {
      return null
    }
  }

  cacheSet(key: string, value: PositionAnalysis): void {
    this.db
      .prepare('INSERT INTO analysis_cache (key, data, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data')
      .run(key, JSON.stringify(value), new Date().toISOString())
  }

  clearCache(): void {
    this.db.exec('DELETE FROM analysis_cache')
  }

  // ----- coach conversation -----

  addMessage(gameId: number, coachId: string, positionKey: string, msg: ChatMessage): void {
    this.db
      .prepare('INSERT INTO messages (game_id, coach_id, position_key, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(gameId, coachId, positionKey, msg.role, msg.content, new Date().toISOString())
  }

  getMessages(gameId: number): { coachId: string; positionKey: string; role: ChatMessage['role']; content: string; createdAt: string }[] {
    return (
      this.db.prepare('SELECT coach_id, position_key, role, content, created_at FROM messages WHERE game_id = ? ORDER BY id').all(gameId) as {
        coach_id: string
        position_key: string
        role: ChatMessage['role']
        content: string
        created_at: string
      }[]
    ).map((r) => ({ coachId: r.coach_id, positionKey: r.position_key, role: r.role, content: r.content, createdAt: r.created_at }))
  }

  clearMessages(gameId: number): void {
    this.db.prepare('DELETE FROM messages WHERE game_id = ?').run(gameId)
  }

  getExplanation(gameId: number, coachId: string, positionKey: string, model: string): string | null {
    const row = this.db
      .prepare('SELECT text FROM explanations WHERE game_id = ? AND coach_id = ? AND position_key = ? AND model = ?')
      .get(gameId, coachId, positionKey, model) as { text: string } | undefined
    return row?.text ?? null
  }

  saveExplanation(gameId: number, coachId: string, positionKey: string, model: string, text: string): void {
    this.db
      .prepare(
        `INSERT INTO explanations (game_id, coach_id, position_key, model, text, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, coach_id, position_key) DO UPDATE SET model = excluded.model, text = excluded.text, created_at = excluded.created_at`
      )
      .run(gameId, coachId, positionKey, model, text, new Date().toISOString())
  }

  deleteExplanation(gameId: number, coachId: string, positionKey: string): void {
    this.db.prepare('DELETE FROM explanations WHERE game_id = ? AND coach_id = ? AND position_key = ?').run(gameId, coachId, positionKey)
  }

  // ----- settings -----

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return null
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  // ----- backup / restore -----

  /** Write a consistent single-file copy of the whole database. */
  backupTo(dest: string): void {
    rmSync(dest, { force: true })
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  }

  /** Replace the database with a backup after checking it really is one of ours. */
  restoreFrom(src: string): void {
    if (!existsSync(src)) throw new Error('The backup file does not exist.')
    let probe: DatabaseSync
    try {
      probe = new DatabaseSync(src, { readOnly: true })
    } catch {
      throw new Error('That file is not a valid backup.')
    }
    let problem: string | null = null
    try {
      const ok = probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('games', 'reviews', 'settings')").get() as { n: number }
      const integrity = probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (ok.n !== 3) problem = 'That file is not a backup created by this application.'
      else if (integrity.integrity_check !== 'ok') problem = 'The backup file is damaged.'
    } catch {
      problem = 'That file is not a valid backup.'
    } finally {
      probe.close()
    }
    if (problem) throw new Error(problem)
    this.db.close()
    for (const ext of ['', '-wal', '-shm']) rmSync(this.file + ext, { force: true })
    copyFileSync(src, this.file)
    this.db = this.open()
  }
}
