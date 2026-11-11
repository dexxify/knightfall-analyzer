import { CHESSCOM_MANUAL_HELP, LICHESS_MANUAL_HELP, parseImportUrl, type ImportTarget } from '@shared/import-urls'

/**
 * Game import from the two documented public APIs:
 *  - Chess.com Published-Data API  (https://www.chess.com/news/view/published-data-api)
 *  - Lichess API                   (https://lichess-org.github.io/api/)
 * No scraping, no undocumented endpoints, no authentication bypass. Requests go only to
 * api.chess.com and lichess.org, and only when the user asks for an import.
 */

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly help?: string
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

const UA = 'chess-review-desktop-app'
let lastLichess = 0

async function get(url: string, accept: string): Promise<Response> {
  const u = new URL(url)
  if (u.protocol !== 'https:' || (u.hostname !== 'api.chess.com' && u.hostname !== 'lichess.org')) {
    throw new ImportError('Refusing to contact an unexpected host.')
  }
  if (u.hostname === 'lichess.org') {
    // Lichess asks clients to make one request at a time; space them out.
    const wait = lastLichess + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastLichess = Date.now()
  }
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError'
    throw new ImportError(timeout ? `${u.hostname} took too long to answer.` : `Could not reach ${u.hostname}. Check your internet connection.`)
  }
  if (res.status === 429) throw new ImportError(`${u.hostname} is rate-limiting requests. Wait a minute and try again.`)
  return res
}

export interface ChessComGame {
  url: string
  pgn?: string
  end_time?: number
  time_class?: string
  white: { username: string; rating?: number; result?: string }
  black: { username: string; rating?: number; result?: string }
}

export async function chessComArchives(username: string): Promise<string[]> {
  const user = username.trim().toLowerCase()
  if (!/^[a-z0-9_-]{2,40}$/.test(user)) throw new ImportError('That does not look like a Chess.com username.')
  const res = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`, 'application/json')
  if (res.status === 404) throw new ImportError(`Chess.com has no player called "${username}".`)
  if (!res.ok) throw new ImportError(`Chess.com answered ${res.status} ${res.statusText}.`)
  const data = (await res.json()) as { archives?: string[] }
  return data.archives ?? []
}

export async function chessComMonth(archiveUrl: string): Promise<ChessComGame[]> {
  if (!/^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]+\/games\/\d{4}\/\d{2}$/i.test(archiveUrl)) throw new ImportError('Unexpected archive address.')
  const res = await get(archiveUrl, 'application/json')
  if (!res.ok) throw new ImportError(`Chess.com answered ${res.status} ${res.statusText}.`)
  const data = (await res.json()) as { games?: ChessComGame[] }
  return (data.games ?? []).filter((g) => !!g.pgn)
}

/**
 * The Published-Data API has no "game by id" endpoint; games are only listed inside a
 * player's monthly archives. So a single game link is resolved by searching the archives of
 * one of its players, newest month first.
 */
export async function chessComGameById(gameId: string, username: string, maxMonths = 24): Promise<ChessComGame> {
  const archives = (await chessComArchives(username)).reverse().slice(0, maxMonths)
  if (archives.length === 0) throw new ImportError(`"${username}" has no public games on Chess.com.`, CHESSCOM_MANUAL_HELP)
  for (const a of archives) {
    const games = await chessComMonth(a)
    const hit = games.find((g) => g.url.split('/').pop() === gameId)
    if (hit) return hit
  }
  throw new ImportError(
    `That game was not found in the last ${archives.length} month${archives.length === 1 ? '' : 's'} of ${username}'s public games. Check the username is one of the two players.`,
    CHESSCOM_MANUAL_HELP
  )
}

export async function lichessGame(gameId: string): Promise<string> {
  if (!/^[A-Za-z0-9]{8}$/.test(gameId)) throw new ImportError('That is not a Lichess game id.')
  const res = await get(`https://lichess.org/game/export/${gameId}?clocks=true&evals=false&opening=true&literate=false`, 'application/x-chess-pgn')
  if (res.status === 404) throw new ImportError('Lichess has no public game with that id (it may be private or still in progress).', LICHESS_MANUAL_HELP)
  if (!res.ok) throw new ImportError(`Lichess answered ${res.status} ${res.statusText}.`, LICHESS_MANUAL_HELP)
  return res.text()
}

export async function lichessStudy(studyId: string, chapterId?: string): Promise<string> {
  const path = chapterId ? `${studyId}/${chapterId}` : studyId
  const res = await get(`https://lichess.org/api/study/${path}.pgn?clocks=false&comments=true&variations=true`, 'application/x-chess-pgn')
  if (res.status === 403 || res.status === 401) throw new ImportError('This study is private or does not allow PGN export.', LICHESS_MANUAL_HELP)
  if (res.status === 404) throw new ImportError('Lichess has no study at that address.', LICHESS_MANUAL_HELP)
  if (!res.ok) throw new ImportError(`Lichess answered ${res.status} ${res.statusText}.`, LICHESS_MANUAL_HELP)
  return res.text()
}

export async function lichessPlayerGames(username: string, max = 20): Promise<string> {
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(username)) throw new ImportError('That does not look like a Lichess username.')
  const n = Math.max(1, Math.min(200, Math.floor(max)))
  const res = await get(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${n}&opening=true&clocks=true`, 'application/x-chess-pgn')
  if (res.status === 404) throw new ImportError(`Lichess has no player called "${username}".`)
  if (!res.ok) throw new ImportError(`Lichess answered ${res.status} ${res.statusText}.`)
  return res.text()
}

export interface UrlImport {
  pgn: string
  source: 'chesscom' | 'lichess'
  sourceUrl: string
}

/** Resolve a pasted link to PGN text. `username` is only needed for Chess.com game links. */
export async function importFromUrl(input: string, username?: string): Promise<UrlImport> {
  const target: ImportTarget | null = parseImportUrl(input)
  if (!target) {
    throw new ImportError('That link is not a Chess.com or Lichess game, study or player address. You can paste the PGN text instead.')
  }
  const sourceUrl = input.trim()
  if (target.site === 'lichess') {
    if (target.kind === 'game') return { pgn: await lichessGame(target.gameId), source: 'lichess', sourceUrl }
    if (target.kind === 'study') return { pgn: await lichessStudy(target.studyId, target.chapterId), source: 'lichess', sourceUrl }
    return { pgn: await lichessPlayerGames(target.username, 20), source: 'lichess', sourceUrl }
  }
  if (target.kind === 'player') {
    const archives = await chessComArchives(target.username)
    if (archives.length === 0) throw new ImportError(`"${target.username}" has no public games on Chess.com.`)
    const games = await chessComMonth(archives[archives.length - 1])
    return { pgn: games.map((g) => g.pgn).join('\n\n'), source: 'chesscom', sourceUrl }
  }
  if (!username?.trim()) {
    throw new ImportError(
      "Chess.com's public API lists games by player, not by game number. Enter the Chess.com username of either player so the game can be found in their archive.",
      CHESSCOM_MANUAL_HELP
    )
  }
  const game = await chessComGameById(target.gameId, username)
  return { pgn: game.pgn!, source: 'chesscom', sourceUrl: game.url }
}
