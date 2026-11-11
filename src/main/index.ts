import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import os from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME } from '@shared/app'
import type { Api, ChessComGameSummary, LoadedGame } from '@shared/api'
import { API_NAMESPACES } from '@shared/api'
import type { GameRecord, ImportResult, ProviderConfig, ProviderKind, Settings } from '@shared/types'
import { defaultSettings, PROVIDER_DEFAULTS } from '@shared/defaults'
import { parseGame, parseMany } from '@shared/pgn'
import { identifyOpening, type OpeningTable } from '@shared/openings'
import { annotatedPgn } from '@shared/export'
import { slugify, type CoachProfile } from '@shared/coach'
import { Database } from './db'
import { paths, setDataRoot, setResourcesRoot } from './system/paths'
import { cancelDownload, progressBus } from './system/download'
import { detectHardware } from './system/hardware'
import { EngineService } from './engine/service'
import { enginePath, getEngineInfo, installStockfish, removeEngine, useManualEngine } from './engine/install'
import { chessComArchives, chessComMonth, ImportError, importFromUrl, lichessPlayerGames } from './import'
import * as coaches from './coaches'
import { CoachService, makeProvider } from './ai/coach-service'
import { discoverLocalServers } from './ai/providers'
import { installLlm, LLM_CATALOG, llmStatus, recommendLlm, removeLlm, verifyLlm } from './ai/catalog'
import { builtinRuntime } from './ai/builtin'
import { TtsService } from './tts/service'

let win: BrowserWindow | null = null
let db: Database
let settings: Settings
let engines: EngineService
let coachService: CoachService
let tts: TtsService
let openings: OpeningTable = {}
let corePrompt = ''

const send = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------- settings (API keys are encrypted with the OS keychain via safeStorage) ----------

function loadSettings(): Settings {
  const defaults = defaultSettings(os.cpus().length, os.totalmem() / 1024 ** 3)
  const stored = db.getSetting<Partial<Settings>>('settings') ?? {}
  const merged: Settings = { ...defaults, ...stored, engine: { ...defaults.engine, ...stored.engine }, thresholds: { ...defaults.thresholds, ...stored.thresholds } }
  merged.provider = { ...PROVIDER_DEFAULTS[merged.provider?.kind ?? 'builtin'], ...merged.provider }
  const secrets = db.getSetting<Record<string, string>>('secrets') ?? {}
  const decrypt = (kind: string): string => {
    const enc = secrets[kind]
    if (!enc) return ''
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : ''
    } catch {
      return ''
    }
  }
  merged.provider.apiKey = decrypt(merged.provider.kind)
  for (const k of Object.keys(merged.providers) as ProviderKind[]) merged.providers[k] = { ...merged.providers[k]!, apiKey: decrypt(k) }
  return merged
}

function saveSettings(next: Settings): void {
  const secrets = db.getSetting<Record<string, string>>('secrets') ?? {}
  const strip = (cfg: ProviderConfig): ProviderConfig => {
    if (cfg.apiKey !== undefined) {
      if (cfg.apiKey && safeStorage.isEncryptionAvailable()) secrets[cfg.kind] = safeStorage.encryptString(cfg.apiKey).toString('base64')
      else if (!cfg.apiKey) delete secrets[cfg.kind]
    }
    const { apiKey: _omit, ...rest } = cfg
    return rest
  }
  const providers: Settings['providers'] = {}
  for (const k of Object.keys(next.providers) as ProviderKind[]) providers[k] = strip(next.providers[k]!)
  db.setSetting('settings', { ...next, provider: strip(next.provider), providers })
  db.setSetting('secrets', secrets)
}

// ---------- games ----------

function storeGames(pgnText: string, source: GameRecord['source'], sourceUrl?: string | null): ImportResult {
  const { games, errors } = parseMany(pgnText)
  const imported: GameRecord[] = []
  let skipped = 0
  for (const g of games) {
    const op = identifyOpening(g.plies, openings)
    const r = db.addGame(g, { source, sourceUrl: games.length === 1 ? sourceUrl : null, eco: op?.eco ?? null, opening: op?.name ?? null })
    if (r.inserted) imported.push(r.record)
    else skipped++
  }
  return { imported, skipped, errors }
}

function loadGame(id: number): LoadedGame | null {
  const record = db.getGame(id)
  if (!record) return null
  const game = parseGame(record.pgn)
  const op = identifyOpening(game.plies, openings)
  return { record, game, review: db.getReview(id), opening: op ? { eco: op.eco, name: op.name, lastBookPly: op.lastBookPly } : null }
}

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 60)
}

async function saveTextDialog(defaultName: string, ext: string, label: string, content: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: label, extensions: [ext] }] })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, content, 'utf8')
  return r.filePath
}

// ---------- API implementation ----------

function buildApi(): Api {
  return {
    app: {
      info: async () => ({ name: APP_NAME, version: app.getVersion(), dataDir: paths.root(), platform: process.platform, packaged: app.isPackaged }),
      openDataFolder: async () => void (await shell.openPath(paths.root())),
      openExternal: async (url) => {
        const u = new URL(url)
        if (u.protocol === 'https:') await shell.openExternal(u.toString())
      }
    },
    settings: {
      get: async () => settings,
      set: async (patch) => {
        const engineChanged = !!patch.engine && (patch.engine.threads !== settings.engine.threads || patch.engine.hashMb !== settings.engine.hashMb)
        settings = { ...settings, ...patch }
        if (patch.provider) settings.providers = { ...settings.providers, [patch.provider.kind]: patch.provider }
        saveSettings(settings)
        if (engineChanged) await engines.restart()
        return settings
      },
      reset: async () => {
        const keep = { setupComplete: settings.setupComplete }
        settings = { ...defaultSettings(os.cpus().length, os.totalmem() / 1024 ** 3), ...keep }
        db.setSetting('secrets', {})
        saveSettings(settings)
        await engines.restart()
        return settings
      }
    },
    hardware: { detect: (force) => detectHardware(force) },
    engine: {
      info: (checkLatest) => getEngineInfo(checkLatest),
      install: async () => {
        await engines.restart()
        return installStockfish()
      },
      chooseFile: async () => {
        const r = await dialog.showOpenDialog(win!, { title: 'Choose a UCI chess engine', properties: ['openFile'] })
        if (r.canceled || !r.filePaths[0]) return null
        await engines.restart()
        return useManualEngine(r.filePaths[0])
      },
      remove: async () => {
        await engines.restart()
        removeEngine()
        return getEngineInfo()
      },
      test: () => engines.selfTest(),
      restart: () => engines.restart()
    },
    games: {
      list: async (filter) => db.listGames(filter),
      get: async (id) => loadGame(id),
      importPgn: async (text) => storeGames(text, 'pgn'),
      importFiles: async (given) => {
        let files = given
        if (!files) {
          const r = await dialog.showOpenDialog(win!, { title: 'Import PGN files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PGN', extensions: ['pgn', 'txt'] }] })
          if (r.canceled) return null
          files = r.filePaths
        }
        const total: ImportResult = { imported: [], skipped: 0, errors: [] }
        for (const f of files) {
          try {
            const r = storeGames(readFileSync(f, 'utf8'), 'pgn')
            total.imported.push(...r.imported)
            total.skipped += r.skipped
            total.errors.push(...r.errors.map((e) => `${f.split(/[\\/]/).pop()}: ${e}`))
          } catch (e) {
            total.errors.push(`${f.split(/[\\/]/).pop()}: ${e instanceof Error ? e.message : e}`)
          }
        }
        return total
      },
      importUrl: async (url, username) => {
        const r = await importFromUrl(url, username)
        return storeGames(r.pgn, r.source, r.sourceUrl)
      },
      chesscomArchives: (username) => chessComArchives(username),
      chesscomMonth: async (archiveUrl) =>
        (await chessComMonth(archiveUrl))
          .map(
            (g): ChessComGameSummary => ({
              url: g.url,
              white: g.white.username,
              black: g.black.username,
              whiteRating: g.white.rating ?? null,
              blackRating: g.black.rating ?? null,
              result: g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '1/2-1/2',
              timeClass: g.time_class ?? '',
              endTime: g.end_time ?? null
            })
          )
          .reverse(),
      importChesscom: async (archiveUrl, gameUrls) => {
        const games = await chessComMonth(archiveUrl)
        const chosen = gameUrls ? games.filter((g) => gameUrls.includes(g.url)) : games
        const total: ImportResult = { imported: [], skipped: 0, errors: [] }
        for (const g of chosen) {
          const r = storeGames(g.pgn!, 'chesscom', g.url)
          total.imported.push(...r.imported)
          total.skipped += r.skipped
          total.errors.push(...r.errors)
        }
        return total
      },
      lichessPlayer: async (username, max) => storeGames(await lichessPlayerGames(username, max), 'lichess'),
      update: async (id, patch) => db.updateGame(id, patch),
      remove: async (id) => {
        engines.cancelReview(id)
        db.deleteGame(id)
      },
      exportPgn: async (id, annotated) => {
        const g = loadGame(id)
        if (!g) return null
        const text = annotated ? annotatedPgn(g.game, g.review, APP_NAME) : g.record.pgn + '\n'
        return saveTextDialog(`${safeName(g.record.white)}_vs_${safeName(g.record.black)}.pgn`, 'pgn', 'PGN', text)
      },
      exportAnalysis: async (id) => {
        const g = loadGame(id)
        if (!g) return null
        const payload = { application: APP_NAME, exportedAt: new Date().toISOString(), game: g.record, opening: g.opening, review: g.review, conversation: db.getMessages(id) }
        return saveTextDialog(`${safeName(g.record.white)}_vs_${safeName(g.record.black)}_analysis.json`, 'json', 'Analysis (JSON)', JSON.stringify(payload, null, 2))
      },
      copyPgn: async (id, annotated) => {
        const g = loadGame(id)
        if (!g) return ''
        const text = annotated ? annotatedPgn(g.game, g.review, APP_NAME) : g.record.pgn
        clipboard.writeText(text)
        return text
      },
      folders: async () => db.folders(),
      tags: async () => db.tags(),
      stats: async () => db.stats()
    },
    review: {
      start: async (gameId, presetId) => {
        const g = loadGame(gameId)
        if (!g) throw new Error('That game no longer exists.')
        const preset = settings.presets.find((p) => p.id === presetId) ?? settings.presets[1]
        const op = identifyOpening(g.game.plies, openings)
        const review = await engines.reviewGame(gameId, g.game.plies, preset, {
          inBook: op?.inBook,
          thresholds: settings.thresholds,
          onProgress: (p) => send('review:progress', p)
        })
        db.saveReview(gameId, review)
        return review
      },
      cancel: async (gameId) => engines.cancelReview(gameId)
    },
    analysis: {
      position: (fen, token) =>
        engines.analyzePosition(fen, { depth: settings.liveDepth, movetimeMs: 4000, multipv: settings.liveMultipv }, (analysis) => send('analysis:update', { token, analysis })),
      stop: async () => engines.stopLive()
    },
    coaches: {
      list: async () => coaches.listCoaches(),
      save: async (c) => coaches.saveCoach(c),
      remove: async (id) => coaches.deleteCoach(id),
      duplicate: async (id) => coaches.duplicateCoach(id),
      exportFile: async (id) => {
        const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), `${slugify(id)}.coach.json`), filters: [{ name: 'Coach', extensions: ['json'] }] })
        if (r.canceled || !r.filePath) return null
        coaches.exportCoach(id, r.filePath)
        return r.filePath
      },
      importFile: async () => {
        const r = await dialog.showOpenDialog(win!, { title: 'Import a coach', properties: ['openFile'], filters: [{ name: 'Coach', extensions: ['json'] }] })
        if (r.canceled || !r.filePaths[0]) return null
        return coaches.importCoach(r.filePaths[0])
      },
      generate: async (description) => generateCoach(description),
      newId: async (name) => coaches.uniqueCoachId(name),
      chooseVoiceReference: async (id, transcript) => {
        const r = await dialog.showOpenDialog(win!, { title: 'Choose a reference recording (WAV)', properties: ['openFile'], filters: [{ name: 'WAV audio', extensions: ['wav'] }] })
        if (r.canceled || !r.filePaths[0]) return null
        return coaches.setVoiceReference(id, r.filePaths[0], transcript)
      },
      isCustomized: async (id) => coaches.isCustomized(id)
    },
    ai: {
      status: (cfg) => coachService.status(cfg),
      discover: () => discoverLocalServers(),
      catalog: async () => {
        const hw = await detectHardware()
        return { entries: LLM_CATALOG, status: llmStatus(hw), recommendations: recommendLlm(hw) }
      },
      installModel: async (id) => {
        await installLlm(id)
        // First installed model becomes the active one, so the coach works without a trip to settings.
        if (settings.provider.kind === 'builtin' && !settings.provider.model) {
          settings = { ...settings, provider: { ...settings.provider, model: id } }
          saveSettings(settings)
        }
      },
      removeModel: async (id) => {
        if (settings.provider.kind === 'builtin' && settings.provider.model === id) {
          await builtinRuntime.unload()
          settings = { ...settings, provider: { ...settings.provider, model: '' } }
          saveSettings(settings)
        }
        removeLlm(id)
      },
      verifyModel: (id) => verifyLlm(id),
      explain: (req) => coachService.explain(req, (text) => send('ai:token', { requestId: req.requestId, text })),
      cancel: async (requestId) => coachService.cancel(requestId),
      systemPrompt: async () => {
        const coach = coaches.getCoach(settings.coachId) ?? coaches.listCoaches()[0]
        return { core: settings.customSystemPrompt?.trim() ? settings.customSystemPrompt : corePrompt, isCustom: !!settings.customSystemPrompt?.trim(), composed: coach ? coachService.systemPromptFor(coach) : '' }
      },
      messages: async (gameId) => db.getMessages(gameId),
      clearMessages: async (gameId) => db.clearMessages(gameId)
    },
    tts: {
      engines: async () => tts.list(settings.ttsQuality),
      voices: async (engine) => tts.voices(engine),
      install: (engine) => tts.install(engine, settings.ttsQuality),
      remove: (engine) => tts.remove(engine),
      speak: async (args) => {
        const coach = args.coachId ? coaches.getCoach(args.coachId) : null
        const override = coach ? settings.voiceOverrides[`${settings.ttsEngine}:${coach.id}`] : undefined
        return tts.speak({
          text: args.text,
          engine: settings.ttsEngine,
          quality: settings.ttsQuality,
          speed: settings.speechSpeed * (coach?.voice.speed ?? 1),
          coach,
          // With "change voice with coach" off, every coach keeps the pinned voice.
          voice: args.voice ?? (!settings.coachChangesVoice && settings.pinnedVoice ? settings.pinnedVoice : override),
          generation: args.generation
        })
      },
      cancelBefore: async (generation) => tts.cancelBefore(generation),
      benchmark: (engine) => tts.benchmark(engine, settings.ttsQuality),
      recommend: async () => tts.recommend(await detectHardware()),
      coachVoice: async (coachId) => {
        const coach = coaches.getCoach(coachId)
        if (!coach) return ''
        return settings.voiceOverrides[`${settings.ttsEngine}:${coach.id}`] ?? tts.voiceFor(settings.ttsEngine, coach)
      }
    },
    downloads: { cancel: async (id) => cancelDownload(id) },
    data: {
      backup: async () => {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), `${APP_NAME.toLowerCase()}-backup-${stamp}.db`), filters: [{ name: 'Backup', extensions: ['db'] }] })
        if (r.canceled || !r.filePath) return null
        db.backupTo(r.filePath)
        return r.filePath
      },
      restore: async () => {
        const r = await dialog.showOpenDialog(win!, { title: 'Restore a backup', properties: ['openFile'], filters: [{ name: 'Backup', extensions: ['db'] }] })
        if (r.canceled || !r.filePaths[0]) return false
        engines.cancelAll()
        coachService.cancelAll()
        db.restoreFrom(r.filePaths[0])
        settings = loadSettings()
        return true
      },
      exportAllPgn: async () => {
        const all = db.listGames({}, 100000)
        if (all.length === 0) return null
        return saveTextDialog(`${APP_NAME.toLowerCase()}-games.pgn`, 'pgn', 'PGN', all.map((g) => g.pgn.trim()).join('\n\n') + '\n')
      },
      deleteAllGames: async () => {
        engines.cancelAll()
        db.deleteAllGames()
      },
      clearAnalysisCache: async () => db.clearCache(),
      repair: async () => repairInstallation()
    }
  }
}

/** "Create your own coach": let the active model turn a description into a profile; fall back to rules. */
async function generateCoach(description: string): Promise<{ coach: CoachProfile; usedAi: boolean }> {
  const desc = description.trim().slice(0, 1500)
  const base = (name: string): CoachProfile =>
    coaches.normalize({
      id: coaches.uniqueCoachId(name),
      name,
      category: 'custom',
      builtin: false,
      description: desc,
      traits: coaches.traitsFromDescription(desc),
      prompt: `You are a chess coach with this personality: ${desc}\n\nStay in this character in everything you say. Whatever your tone, every reaction includes the concrete chess reason: what the move did, what it allowed, and what the better move was.`,
      voice: { kokoro: /\b(she|her|woman|female|girl|lady)\b/i.test(desc) ? 'af_sarah' : 'am_michael', design: '', speed: 1 }
    })
  try {
    const provider = makeProvider({ ...settings.provider, temperature: 0.6, maxTokens: 900, streaming: false })
    const st = await provider.status()
    if (!st.ok) return { coach: base('My Coach'), usedAi: false }
    const text = await provider.chat(
      [
        { role: 'system', content: coaches.COACH_BUILDER_PROMPT },
        { role: 'user', content: desc }
      ],
      () => undefined,
      AbortSignal.timeout(120_000)
    )
    const j = coaches.parseCoachJson(text)
    if (!j || typeof j.name !== 'string') return { coach: base('My Coach'), usedAi: false }
    const female = j.gender === 'female'
    const coach = coaches.normalize({
      id: coaches.uniqueCoachId(j.name),
      name: j.name,
      category: 'custom',
      builtin: false,
      tagline: j.tagline as string,
      description: (j.description as string) || desc,
      approach: j.approach as string,
      traits: j.traits as CoachProfile['traits'],
      sentenceLength: j.sentenceLength as CoachProfile['sentenceLength'],
      vocabulary: j.vocabulary as string[],
      intro: j.intro as string,
      prompt: typeof j.prompt === 'string' && j.prompt.length > 80 ? j.prompt : base(j.name).prompt,
      voice: { kokoro: female ? 'af_sarah' : 'am_michael', design: String(j.voiceDesign ?? ''), speed: 1 }
    })
    return { coach, usedAi: true }
  } catch {
    return { coach: base('My Coach'), usedAi: false }
  }
}

/** One-click repair: re-check every installed component and report what was found in plain language. */
async function repairInstallation(): Promise<string[]> {
  const report: string[] = []
  await engines.restart()
  const info = await getEngineInfo()
  if (!info.installed) report.push('Stockfish is not installed. Use Install Stockfish to add it.')
  else {
    try {
      const t = await engines.selfTest()
      report.push(`Stockfish is working (${t.name}).`)
    } catch (e) {
      report.push(`Stockfish did not respond (${e instanceof Error ? e.message : e}). Reinstall it from Settings → Engine.`)
    }
  }
  const hw = await detectHardware(true)
  for (const s of llmStatus(hw)) {
    const name = LLM_CATALOG.find((e) => e.id === s.id)!.name
    if (s.state === 'broken') {
      removeLlm(s.id)
      report.push(`${name} was incomplete and has been removed. Download it again from Settings → AI Coach.`)
    } else if (s.state === 'installed') {
      report.push((await verifyLlm(s.id)) ? `${name} is intact.` : `${name} failed its integrity check. Remove it and download it again.`)
    }
  }
  for (const e of tts.list(settings.ttsQuality)) {
    if (e.state === 'broken') report.push(`${e.name} voice engine is incomplete. Reinstall it from Settings → Voice.`)
    else if (e.state === 'installed') report.push(`${e.name} voice engine is installed.`)
  }
  if (!coaches.getCoach(settings.coachId)) {
    settings = { ...settings, coachId: 'mentor' }
    saveSettings(settings)
    report.push('The selected coach was missing; switched back to The Mentor.')
  }
  db.clearCache()
  report.push('Cleared the engine analysis cache.')
  return report
}

function registerIpc(api: Api): void {
  for (const ns of API_NAMESPACES) {
    const group = api[ns] as Record<string, (...args: unknown[]) => Promise<unknown>>
    for (const [name, fn] of Object.entries(group)) {
      ipcMain.handle(`${ns}.${name}`, async (event, ...args) => {
        // Only our own window may call in.
        if (event.senderFrame !== win?.webContents.mainFrame) return { ok: false, error: 'Rejected' }
        try {
          return { ok: true, data: await fn(...args) }
        } catch (e) {
          const err = e as Error
          return { ok: false, error: err?.message ?? String(e), help: e instanceof ImportError ? e.help : undefined, name: err?.name }
        }
      })
    }
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#15171a',
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (!(dev && url.startsWith(dev))) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

// Must happen before the single-instance lock, which is tied to the data folder.
if (process.env.KNIGHTFALL_DATA_DIR) app.setPath('userData', process.env.KNIGHTFALL_DATA_DIR)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    setDataRoot(app.getPath('userData'))
    const res = app.isPackaged ? process.resourcesPath : app.getAppPath()
    setResourcesRoot(res)
    const openingsFile = app.isPackaged ? join(res, 'openings.json') : join(res, 'resources', 'openings.json')
    try {
      openings = JSON.parse(readFileSync(openingsFile, 'utf8')) as OpeningTable
    } catch {
      openings = {}
    }
    const promptFile = join(res, 'AI_SYSTEM_PROMPT.md')
    corePrompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : ''

    db = new Database(paths.db())
    settings = loadSettings()
    engines = new EngineService(
      () => enginePath(),
      () => settings.engine,
      { get: (k) => db.cacheGet(k), set: (k, v) => db.cacheSet(k, v) }
    )
    coachService = new CoachService({
      settings: () => settings,
      corePrompt: () => corePrompt,
      coach: (id) => coaches.getCoach(id),
      store: {
        getExplanation: (g, c, p, m) => db.getExplanation(g, c, p, m),
        saveExplanation: (g, c, p, m, t) => db.saveExplanation(g, c, p, m, t),
        addMessage: (g, c, p, msg) => db.addMessage(g, c, p, msg),
        recentMessages: (g, limit) =>
          db
            .getMessages(g)
            .slice(-limit)
            .map((m) => ({ role: m.role, content: m.content }))
      }
    })
    tts = new TtsService(
      () => db.getSetting<Record<string, number>>('ttsMeasured') ?? {},
      (m) => db.setSetting('ttsMeasured', m)
    )
    progressBus.on('progress', (p) => send('download:progress', p))
    registerIpc(buildApi())
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void Promise.allSettled([engines?.shutdown(), tts?.shutdown(), builtinRuntime.unload()]).then(() => {
      try {
        db?.close()
      } catch {
        /* already closed */
      }
      app.exit(0)
    })
  })
}
