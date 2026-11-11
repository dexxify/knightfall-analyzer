/** Recognise game links from Chess.com and Lichess. Pure functions; no network. */

export type ImportTarget =
  | { site: 'chesscom'; kind: 'game'; gameId: string; gameType: 'live' | 'daily' }
  | { site: 'chesscom'; kind: 'player'; username: string }
  | { site: 'lichess'; kind: 'game'; gameId: string }
  | { site: 'lichess'; kind: 'study'; studyId: string; chapterId?: string }
  | { site: 'lichess'; kind: 'player'; username: string }

const LICHESS_RESERVED = new Set([
  'study', 'training', 'analysis', 'editor', 'tournament', 'swiss', 'broadcast', 'tv', 'games', 'player', 'team', 'forum',
  'blog', 'learn', 'practice', 'coach', 'streamer', 'video', 'opening', 'api', 'account', 'login', 'signup', 'paste',
  'inbox', 'patron', 'simul', 'variant', 'puzzle', 'storm', 'racer', 'streak', 'insights', 'class', 'page', 'embed'
])

export function parseImportUrl(input: string): ImportTarget | null {
  let url: URL
  try {
    url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'chess.com') {
    // /game/live/123, /game/daily/123, /game/123, /analysis/game/live/123, /live/game/123
    const i = parts.indexOf('game')
    if (i >= 0) {
      const rest = parts.slice(i + 1)
      const type = rest[0] === 'daily' ? 'daily' : 'live'
      const id = rest.find((p) => /^\d+$/.test(p))
      if (id) return { site: 'chesscom', kind: 'game', gameId: id, gameType: parts.includes('daily') ? 'daily' : type }
    }
    if ((parts[0] === 'member' || parts[0] === 'players') && parts[1]) return { site: 'chesscom', kind: 'player', username: parts[1].toLowerCase() }
    if (parts[0] === 'games' && parts[1] === 'archive' && parts[2]) return { site: 'chesscom', kind: 'player', username: parts[2].toLowerCase() }
    return null
  }

  if (host === 'lichess.org') {
    if (parts[0] === 'study' && /^[A-Za-z0-9]{8}$/.test(parts[1] ?? '')) {
      return { site: 'lichess', kind: 'study', studyId: parts[1], chapterId: /^[A-Za-z0-9]{8}$/.test(parts[2] ?? '') ? parts[2] : undefined }
    }
    if (parts[0] === '@' && parts[1]) return { site: 'lichess', kind: 'player', username: parts[1] }
    if (parts[0]?.startsWith('@') && parts[0].length > 1) return { site: 'lichess', kind: 'player', username: parts[0].slice(1) }
    const first = parts[0] ?? ''
    if (LICHESS_RESERVED.has(first.toLowerCase())) return null
    // Game ids are 8 characters; the 12-character form includes a player token.
    if (/^[A-Za-z0-9]{8}$/.test(first) || /^[A-Za-z0-9]{12}$/.test(first)) return { site: 'lichess', kind: 'game', gameId: first.slice(0, 8) }
    return null
  }
  return null
}

export const CHESSCOM_MANUAL_HELP =
  'To export the PGN yourself: open the game on Chess.com, click the Share button under the board, choose the PGN tab, copy the text, then paste it into the PGN tab here.'

export const LICHESS_MANUAL_HELP =
  'To export the PGN yourself: open the game on Lichess, scroll to "FEN & PGN" below the board, click "Download raw" or copy the PGN text, then paste it into the PGN tab here.'
