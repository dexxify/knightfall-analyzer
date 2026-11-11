import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ClipboardPaste, FileUp, FolderOpen, Link2, Plus, Search, Tag, Trash2 } from 'lucide-react'
import type { GameFilter, GameRecord, ImportResult } from '@shared/types'
import type { ChessComGameSummary } from '@shared/api'
import { parseImportUrl } from '@shared/import-urls'
import { APP_NAME } from '@shared/app'
import { api, ApiError, errorText, pathForFile } from '../lib/api'
import { useApp } from '../lib/store'
import { useGame } from '../lib/game'
import { useCoach } from '../lib/coach'
import { Badge, Button, cx, Empty, IconButton, Modal, Notice, Select, Spinner } from '../components/ui'

export async function openGame(id: number): Promise<void> {
  const app = useApp.getState()
  try {
    await useGame.getState().load(id)
    await useCoach.getState().loadThread(id)
    app.setView('analyze')
  } catch (e) {
    app.toast('error', errorText(e))
  }
}

function resultTone(r: string): 'good' | 'bad' | 'neutral' {
  return r === '1-0' ? 'good' : r === '0-1' ? 'bad' : 'neutral'
}

export function GameRow({ g, onChanged, compact }: { g: GameRecord; onChanged?: () => void; compact?: boolean }): ReactNode {
  const [editing, setEditing] = useState(false)
  const [folder, setFolder] = useState(g.folder ?? '')
  const [tags, setTags] = useState(g.tags.join(', '))
  const toast = useApp((a) => a.toast)
  const save = async (): Promise<void> => {
    await api.games.update(g.id, { folder: folder.trim() || null, tags: tags.split(',') })
    setEditing(false)
    onChanged?.()
  }
  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete ${g.white} vs ${g.black}? Its analysis and coach conversation are deleted too.`)) return
    await api.games.remove(g.id)
    if (useGame.getState().loaded?.record.id === g.id) useGame.getState().close()
    toast('info', 'Game deleted')
    onChanged?.()
  }
  return (
    <div className="border-b border-line last:border-0">
      <div className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-2">
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void openGame(g.id)}>
          <Badge tone={resultTone(g.result)}>{g.result}</Badge>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              {g.white} {g.whiteElo && <span className="num font-normal text-ink-3">({g.whiteElo})</span>} <span className="font-normal text-ink-3">vs</span> {g.black}{' '}
              {g.blackElo && <span className="num font-normal text-ink-3">({g.blackElo})</span>}
            </span>
            <span className="block truncate text-[12.5px] text-ink-3">
              {[g.opening, g.date, g.timeControl, `${Math.ceil(g.plyCount / 2)} moves`].filter(Boolean).join(' · ')}
            </span>
          </span>
          {!compact && g.folder && <Badge>{g.folder}</Badge>}
          {!compact && g.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          {g.hasReview ? (
            <span className="num w-24 text-right text-[12.5px] text-ink-2" title="Accuracy: White / Black">
              {g.accuracyWhite?.toFixed(0)} / {g.accuracyBlack?.toFixed(0)}
            </span>
          ) : (
            <span className="w-24 text-right text-[12px] text-ink-3">Not reviewed</span>
          )}
        </button>
        {!compact && (
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton label="Folder and tags" onClick={() => setEditing(!editing)}>
              <Tag size={15} />
            </IconButton>
            <IconButton label="Delete game" onClick={() => void remove()}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex items-end gap-2 bg-surface-2 px-3 pb-3">
          <label className="flex-1 text-[12.5px] text-ink-2">
            Folder
            <input className="field mt-1" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. Tournament 2026" />
          </label>
          <label className="flex-1 text-[12.5px] text-ink-2">
            Tags (comma separated)
            <input className="field mt-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. sicilian, endgame" />
          </label>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}

export function Library(): ReactNode {
  const { setImportOpen, toast } = useApp()
  const [games, setGames] = useState<GameRecord[] | null>(null)
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('')
  const [tag, setTag] = useState('')
  const [result, setResult] = useState('')
  const [source, setSource] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const importOpen = useApp((a) => a.importOpen)

  const refresh = useCallback(async () => {
    const filter: GameFilter = { search: search.trim() || undefined, folder: folder || undefined, tag: tag || undefined, result: result || undefined, source: source || undefined }
    const [list, f, t] = await Promise.all([api.games.list(filter), api.games.folders(), api.games.tags()])
    setGames(list)
    setFolders(f)
    setTags(t)
  }, [search, folder, tag, result, source])

  useEffect(() => {
    const t = setTimeout(() => void refresh().catch((e) => toast('error', errorText(e))), 120)
    return () => clearTimeout(t)
  }, [refresh, importOpen, toast])

  const filtered = !!(search || folder || tag || result || source)
  return (
    <div className="mx-auto flex h-full max-w-[1100px] flex-col px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[26px]">Game Library</h1>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setImportOpen(true)}>
          Import games
        </Button>
      </div>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-3" />
          <input className="field !pl-8" placeholder="Search players, events, openings, dates" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search games" />
        </div>
        <Select label="Folder" className="!w-40" value={folder} onChange={setFolder} options={[{ value: '', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))]} />
        <Select label="Tag" className="!w-36" value={tag} onChange={setTag} options={[{ value: '', label: 'All tags' }, ...tags.map((f) => ({ value: f, label: f }))]} />
        <Select
          label="Result"
          className="!w-36"
          value={result}
          onChange={setResult}
          options={[
            { value: '', label: 'Any result' },
            { value: '1-0', label: 'White won' },
            { value: '0-1', label: 'Black won' },
            { value: '1/2-1/2', label: 'Draw' }
          ]}
        />
        <Select
          label="Source"
          className="!w-36"
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: 'Any source' },
            { value: 'chesscom', label: 'Chess.com' },
            { value: 'lichess', label: 'Lichess' },
            { value: 'pgn', label: 'PGN' }
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface">
        {games === null ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : games.length === 0 ? (
          <Empty title={filtered ? 'No games match these filters' : 'Your library is empty'} action={!filtered && <Button variant="primary" onClick={() => setImportOpen(true)}>Import your first game</Button>}>
            {filtered ? 'Try a different search or clear a filter.' : 'Games you import are saved on this computer, with their analysis and coach conversations.'}
          </Empty>
        ) : (
          games.map((g) => <GameRow key={g.id} g={g} onChanged={() => void refresh()} />)
        )}
      </div>
      {games && games.length > 0 && <div className="num mt-2 text-[12.5px] text-ink-3">{games.length} game{games.length === 1 ? '' : 's'}</div>}
    </div>
  )
}

// ---------- Import dialog ----------

type ImportTab = 'link' | 'pgn' | 'chesscom' | 'lichess'

export function ImportDialog(): ReactNode {
  const { setImportOpen, toast } = useApp()
  const [tab, setTab] = useState<ImportTab>('link')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; help?: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState(() => localStorage.getItem('chesscomUser') ?? '')
  const [pgn, setPgn] = useState('')
  const [dragging, setDragging] = useState(false)
  const [archives, setArchives] = useState<string[] | null>(null)
  const [month, setMonth] = useState('')
  const [monthGames, setMonthGames] = useState<ChessComGameSummary[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [liUser, setLiUser] = useState(() => localStorage.getItem('lichessUser') ?? '')
  const [liMax, setLiMax] = useState('20')

  const target = parseImportUrl(url)
  const needsUser = target?.site === 'chesscom' && target.kind === 'game'

  const run = async (fn: () => Promise<ImportResult | null>): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const r = await fn()
      if (!r) return
      setResult(r)
      if (r.imported.length === 1 && r.errors.length === 0) {
        setImportOpen(false)
        await openGame(r.imported[0].id)
      } else if (r.imported.length === 0 && r.skipped === 1 && r.errors.length === 0) {
        toast('info', 'That game is already in your library')
      }
    } catch (e) {
      setError({ text: errorText(e), help: e instanceof ApiError ? e.help : undefined })
    } finally {
      setBusy(false)
    }
  }

  const loadArchives = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setMonthGames(null)
    try {
      const a = (await api.games.chesscomArchives(username)).reverse()
      localStorage.setItem('chesscomUser', username.trim())
      setArchives(a)
      if (a.length === 0) setError({ text: `${username} has no public games on Chess.com.` })
      else {
        setMonth(a[0])
        await loadMonth(a[0])
      }
    } catch (e) {
      setError({ text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const loadMonth = async (m: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setMonthGames(await api.games.chesscomMonth(m))
      setPicked(new Set())
    } catch (e) {
      setError({ text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: ImportTab; label: string; icon: ReactNode }[] = [
    { id: 'link', label: 'Game link', icon: <Link2 size={14} /> },
    { id: 'pgn', label: 'PGN', icon: <ClipboardPaste size={14} /> },
    { id: 'chesscom', label: 'Chess.com player', icon: <FolderOpen size={14} /> },
    { id: 'lichess', label: 'Lichess player', icon: <FolderOpen size={14} /> }
  ]

  return (
    <Modal title="Import games" onClose={() => setImportOpen(false)} width={680}>
      <div className="mb-4 flex gap-1 rounded-md bg-surface-2 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              setError(null)
              setResult(null)
            }}
            className={cx('flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-[13px] font-semibold', tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'link' && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (needsUser) localStorage.setItem('chesscomUser', username.trim())
            void run(() => api.games.importUrl(url, needsUser ? username : undefined))
          }}
        >
          <label className="block">
            Chess.com or Lichess link
            <input className="field mt-1" autoFocus placeholder="https://lichess.org/AbCdEfGh  or  https://www.chess.com/game/live/123456789" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          {needsUser && (
            <label className="block">
              Chess.com username of either player
              <input className="field mt-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              <span className="mt-1 block text-[12.5px] text-ink-3">Chess.com's public API lists games by player, not by game number, so the game is looked up in that player's archive.</span>
            </label>
          )}
          {url && !target && <div className="text-[12.5px] text-warn">This does not look like a Chess.com or Lichess game, study or player link.</div>}
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-ink-3">Works with public games, Lichess studies and player pages.</span>
            <Button type="submit" variant="primary" busy={busy} disabled={!target || (needsUser && !username.trim())}>
              Import
            </Button>
          </div>
        </form>
      )}

      {tab === 'pgn' && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const files = [...e.dataTransfer.files].map(pathForFile).filter(Boolean)
              if (files.length) void run(() => api.games.importFiles(files))
            }}
            className={cx('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors', dragging ? 'border-accent bg-accent-soft' : 'border-line')}
          >
            <FileUp size={22} className="text-ink-3" />
            <div>Drop PGN files here</div>
            <Button size="sm" onClick={() => void run(() => api.games.importFiles())}>
              Browse for files
            </Button>
          </div>
          <label className="block">
            Or paste PGN text (one game or many)
            <textarea className="field mt-1 h-40 font-mono text-[12.5px]" value={pgn} onChange={(e) => setPgn(e.target.value)} placeholder={'[Event "…"]\n\n1. e4 e5 2. Nf3 …'} spellCheck={false} />
          </label>
          <div className="flex justify-end">
            <Button variant="primary" busy={busy} disabled={!pgn.trim()} onClick={() => void run(() => api.games.importPgn(pgn))}>
              Import PGN
            </Button>
          </div>
        </div>
      )}

      {tab === 'chesscom' && (
        <div className="space-y-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void loadArchives()
            }}
          >
            <label className="flex-1">
              Chess.com username
              <input className="field mt-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
            </label>
            <Button type="submit" busy={busy && !archives} disabled={!username.trim()}>
              Find games
            </Button>
          </form>
          {archives && archives.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <Select
                  label="Month"
                  className="!w-44"
                  value={month}
                  onChange={(m) => {
                    setMonth(m)
                    void loadMonth(m)
                  }}
                  options={archives.map((a) => {
                    const [y, mo] = a.split('/').slice(-2)
                    return { value: a, label: new Date(Number(y), Number(mo) - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }) }
                  })}
                />
                <div className="flex-1" />
                <Button size="sm" busy={busy} disabled={!monthGames?.length} onClick={() => void run(() => api.games.importChesscom(month, picked.size ? [...picked] : null))}>
                  {picked.size ? `Import ${picked.size} selected` : `Import whole month (${monthGames?.length ?? 0})`}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-line">
                {monthGames?.map((g) => (
                  <label key={g.url} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-0 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={picked.has(g.url)}
                      onChange={(e) => {
                        const n = new Set(picked)
                        if (e.target.checked) n.add(g.url)
                        else n.delete(g.url)
                        setPicked(n)
                      }}
                    />
                    <Badge tone={resultTone(g.result)}>{g.result}</Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {g.white} <span className="num text-ink-3">({g.whiteRating ?? '?'})</span> vs {g.black} <span className="num text-ink-3">({g.blackRating ?? '?'})</span>
                    </span>
                    <span className="text-[12px] text-ink-3">
                      {g.timeClass} · {g.endTime ? new Date(g.endTime * 1000).toLocaleDateString() : ''}
                    </span>
                  </label>
                ))}
                {monthGames?.length === 0 && <div className="px-3 py-4 text-center text-ink-3">No games this month.</div>}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'lichess' && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            localStorage.setItem('lichessUser', liUser.trim())
            void run(() => api.games.lichessPlayer(liUser.trim(), Number(liMax)))
          }}
        >
          <label className="flex-1">
            Lichess username
            <input className="field mt-1" value={liUser} onChange={(e) => setLiUser(e.target.value)} placeholder="username" />
          </label>
          <label>
            Most recent
            <Select className="mt-1 !w-32" value={liMax} onChange={setLiMax} options={['5', '10', '20', '50', '100'].map((v) => ({ value: v, label: `${v} games` }))} />
          </label>
          <Button type="submit" variant="primary" busy={busy} disabled={!liUser.trim()}>
            Import
          </Button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {error && (
          <Notice tone="bad">
            <div>{error.text}</div>
            {error.help && <div className="mt-1.5 text-ink-2">{error.help}</div>}
          </Notice>
        )}
        {result && (result.imported.length > 1 || result.errors.length > 0 || result.skipped > 1) && (
          <Notice tone={result.imported.length ? 'good' : 'warn'}>
            <div>
              Imported {result.imported.length} game{result.imported.length === 1 ? '' : 's'}
              {result.skipped ? `, ${result.skipped} already in your library` : ''}
              {result.errors.length ? `, ${result.errors.length} could not be read` : ''}.
            </div>
            {result.errors.slice(0, 6).map((e, i) => (
              <div key={i} className="mt-1 text-[12.5px] text-ink-2">
                {e}
              </div>
            ))}
            {result.errors.length > 6 && <div className="mt-1 text-[12.5px] text-ink-3">…and {result.errors.length - 6} more.</div>}
          </Notice>
        )}
      </div>
      <p className="mt-4 text-[12px] text-ink-3">
        {APP_NAME} contacts Chess.com and Lichess only when you import, through their official public APIs. It is an independent application and is not affiliated with either site.
      </p>
    </Modal>
  )
}
