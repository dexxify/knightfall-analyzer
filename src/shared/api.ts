import type {
  ChatMessage,
  DownloadProgress,
  EngineInfo,
  GameFilter,
  GameRecord,
  GameReview,
  HardwareInfo,
  ImportResult,
  InstallStatus,
  LlmCatalogEntry,
  ParsedGame,
  PositionAnalysis,
  ProviderConfig,
  ProviderStatus,
  Recommendation,
  ReviewPreset,
  Settings,
  TtsAudio,
  TtsEngineId,
  TtsEngineInfo,
  TtsVoice
} from './types'
import type { CoachProfile } from './coach'
import type { ContextInput } from './context'

export interface LoadedGame {
  record: GameRecord
  game: ParsedGame
  review: GameReview | null
  opening: { eco: string; name: string; lastBookPly: number } | null
}

export interface ExplainRequest {
  requestId: string
  gameId: number | null
  coachId: string
  /** Identifies the position: "ply:12" for the game, "var:<fen>" for a variation. */
  positionKey: string
  context: ContextInput
  /** A follow-up question; absent for automatic move explanations. */
  question?: string
  regenerate?: boolean
}

export interface ExplainResult {
  text: string
  cached: boolean
  /** Moves the model mentioned that are not in the verified context. */
  unverified: string[]
  model: string
}

export interface StoredMessage {
  coachId: string
  positionKey: string
  role: ChatMessage['role']
  content: string
  createdAt: string
}

export interface ChessComGameSummary {
  url: string
  white: string
  black: string
  whiteRating: number | null
  blackRating: number | null
  result: string
  timeClass: string
  endTime: number | null
}

export interface AppInfo {
  name: string
  version: string
  dataDir: string
  platform: string
  packaged: boolean
}

export interface SpeakArgs {
  text: string
  coachId: string | null
  voice?: string
  generation: number
}

/** Everything the UI can ask the main process to do. Channel name = "<namespace>.<method>". */
export interface Api {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
  }
  hardware: { detect(force?: boolean): Promise<HardwareInfo> }
  engine: {
    info(checkLatest?: boolean): Promise<EngineInfo>
    install(): Promise<EngineInfo>
    chooseFile(): Promise<EngineInfo | null>
    remove(): Promise<EngineInfo>
    test(): Promise<{ name: string; bestMove: string; depth: number; nps: number; ms: number }>
    restart(): Promise<void>
  }
  games: {
    list(filter?: GameFilter): Promise<GameRecord[]>
    get(id: number): Promise<LoadedGame | null>
    importPgn(text: string): Promise<ImportResult>
    importFiles(paths?: string[]): Promise<ImportResult | null>
    importUrl(url: string, username?: string): Promise<ImportResult>
    chesscomArchives(username: string): Promise<string[]>
    chesscomMonth(archiveUrl: string): Promise<ChessComGameSummary[]>
    importChesscom(archiveUrl: string, gameUrls: string[] | null): Promise<ImportResult>
    lichessPlayer(username: string, max: number): Promise<ImportResult>
    update(id: number, patch: { folder?: string | null; tags?: string[] }): Promise<GameRecord | null>
    remove(id: number): Promise<void>
    exportPgn(id: number, annotated: boolean): Promise<string | null>
    exportAnalysis(id: number): Promise<string | null>
    copyPgn(id: number, annotated: boolean): Promise<string>
    folders(): Promise<string[]>
    tags(): Promise<string[]>
    stats(): Promise<{ games: number; reviewed: number }>
  }
  review: {
    start(gameId: number, presetId: ReviewPreset['id']): Promise<GameReview>
    cancel(gameId: number): Promise<void>
  }
  analysis: {
    position(fen: string, token: number): Promise<PositionAnalysis | null>
    stop(): Promise<void>
  }
  coaches: {
    list(): Promise<CoachProfile[]>
    save(coach: CoachProfile): Promise<CoachProfile>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<CoachProfile>
    exportFile(id: string): Promise<string | null>
    importFile(): Promise<CoachProfile | null>
    generate(description: string): Promise<{ coach: CoachProfile; usedAi: boolean }>
    newId(name: string): Promise<string>
    chooseVoiceReference(id: string, transcript: string): Promise<CoachProfile | null>
    isCustomized(id: string): Promise<boolean>
  }
  ai: {
    status(cfg?: ProviderConfig): Promise<ProviderStatus>
    discover(): Promise<{ lmstudio: boolean; ollama: boolean }>
    catalog(): Promise<{ entries: LlmCatalogEntry[]; status: InstallStatus[]; recommendations: Recommendation[] }>
    installModel(id: string): Promise<void>
    removeModel(id: string): Promise<void>
    verifyModel(id: string): Promise<boolean>
    explain(req: ExplainRequest): Promise<ExplainResult>
    cancel(requestId: string): Promise<void>
    systemPrompt(): Promise<{ core: string; isCustom: boolean; composed: string }>
    messages(gameId: number): Promise<StoredMessage[]>
    clearMessages(gameId: number): Promise<void>
  }
  tts: {
    engines(): Promise<TtsEngineInfo[]>
    voices(engine: TtsEngineId): Promise<TtsVoice[]>
    install(engine: TtsEngineId): Promise<void>
    remove(engine: TtsEngineId): Promise<void>
    speak(args: SpeakArgs): Promise<TtsAudio | null>
    cancelBefore(generation: number): Promise<void>
    benchmark(engine: TtsEngineId): Promise<number>
    recommend(): Promise<Recommendation[]>
    coachVoice(coachId: string): Promise<string>
  }
  downloads: { cancel(id: string): Promise<boolean> }
  data: {
    backup(): Promise<string | null>
    restore(): Promise<boolean>
    exportAllPgn(): Promise<string | null>
    deleteAllGames(): Promise<void>
    clearAnalysisCache(): Promise<void>
    repair(): Promise<string[]>
  }
}

export interface ApiEvents {
  'download:progress': DownloadProgress
  'review:progress': { gameId: number; done: number; total: number; ply: number }
  'analysis:update': { token: number; analysis: PositionAnalysis }
  'ai:token': { requestId: string; text: string }
}

export const API_NAMESPACES = ['app', 'settings', 'hardware', 'engine', 'games', 'review', 'analysis', 'coaches', 'ai', 'tts', 'downloads', 'data'] as const
