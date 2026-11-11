// ---------- Engine ----------

/** A score, ALWAYS from White's point of view once it leaves the UCI layer. */
export type Score =
  | { type: 'cp'; value: number }
  /** value = moves to mate (positive: White mates). value 0 = checkmate is on the board; `winner` says who won. */
  | { type: 'mate'; value: number; winner?: 'w' | 'b' }

export interface EngineLine {
  multipv: number
  depth: number
  seldepth?: number
  /** White's point of view. */
  score: Score
  /** Win/draw/loss per mille from White's point of view, if the engine reported it. */
  wdl?: [number, number, number]
  nodes?: number
  nps?: number
  /** Principal variation in UCI notation. */
  pv: string[]
  /** Principal variation in SAN, filled in by the rules engine. */
  pvSan: string[]
}

export interface PositionAnalysis {
  fen: string
  depth: number
  lines: EngineLine[]
  bestMove: string | null
  /** True for checkmate / stalemate positions where the engine has nothing to search. */
  terminal?: 'checkmate' | 'stalemate' | 'draw'
}

export interface SearchLimits {
  depth?: number
  movetimeMs?: number
  multipv: number
}

export interface EngineOptions {
  threads: number
  hashMb: number
}

export interface ReviewPreset {
  id: 'quick' | 'standard' | 'deep'
  label: string
  depth: number
  movetimeMs: number
  multipv: number
}

export interface EngineInfo {
  installed: boolean
  path: string | null
  name: string | null
  version: string | null
  source: 'managed' | 'manual' | null
  latestVersion?: string | null
  updateAvailable?: boolean
}

// ---------- Classification ----------

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missed_win'
  | 'forced'

export interface ClassificationThresholds {
  /** Maximum win-probability loss (percentage points, mover's view) for each band. */
  excellent: number
  good: number
  inaccuracy: number
  mistake: number
  /** A position counts as "winning" at or above this win probability. */
  winningAt: number
  /** Gap to the second-best move (points) that makes the best move "great". */
  greatGap: number
}

export interface MoveReview {
  ply: number
  color: 'w' | 'b'
  san: string
  uci: string
  fenBefore: string
  fenAfter: string
  evalBefore: Score
  evalAfter: Score
  /** Win probability (0-100) for the player who moved, before and after. */
  winBefore: number
  winAfter: number
  winLoss: number
  /** Centipawn loss from the mover's view; null when mate scores are involved. */
  cpLoss: number | null
  bestUci: string | null
  bestSan: string | null
  bestLineSan: string[]
  /** Engine continuation after the move that was actually played. */
  playedLineSan: string[]
  /** Other candidate moves from MultiPV, in SAN, with White-POV scores. */
  alternatives: { san: string; uci: string; score: Score; lineSan: string[] }[]
  classification: Classification
  /** Why the classifier chose this label; shown in the UI and given to the coach. */
  reason: string
  accuracy: number
  legalMoveCount: number
  isSacrifice: boolean
  depth: number
}

export interface GameReview {
  presetId: ReviewPreset['id']
  engineName: string
  depth: number
  createdAt: string
  moves: MoveReview[]
  /** White-POV eval for every position, index 0 = start position. */
  evals: Score[]
  accuracy: { white: number; black: number }
  counts: { white: Record<Classification, number>; black: Record<Classification, number> }
  keyMoments: number[]
}

// ---------- Games ----------

export interface Ply {
  ply: number
  color: 'w' | 'b'
  moveNumber: number
  san: string
  uci: string
  fenBefore: string
  fenAfter: string
  comment?: string
}

export interface GameHeaders {
  [key: string]: string
}

export interface ParsedGame {
  headers: GameHeaders
  startFen: string
  plies: Ply[]
  pgn: string
  result: string
}

export interface GameRecord {
  id: number
  white: string
  black: string
  whiteElo: string | null
  blackElo: string | null
  result: string
  date: string | null
  event: string | null
  site: string | null
  timeControl: string | null
  eco: string | null
  opening: string | null
  source: 'chesscom' | 'lichess' | 'pgn'
  sourceUrl: string | null
  pgn: string
  plyCount: number
  folder: string | null
  tags: string[]
  createdAt: string
  hasReview: boolean
  accuracyWhite: number | null
  accuracyBlack: number | null
}

export interface GameFilter {
  search?: string
  folder?: string | null
  tag?: string
  result?: string
  source?: string
}

export interface ImportResult {
  imported: GameRecord[]
  skipped: number
  errors: string[]
}

// ---------- AI ----------

export type ProviderKind = 'builtin' | 'lmstudio' | 'ollama' | 'openai' | 'anthropic'

export interface ProviderConfig {
  kind: ProviderKind
  baseUrl: string
  model: string
  apiKey?: string
  contextWindow: number
  temperature: number
  maxTokens: number
  streaming: boolean
  timeoutMs: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProviderStatus {
  ok: boolean
  message: string
  models: string[]
  /** True when requests leave this computer. */
  remote: boolean
}

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert' | 'auto'

export type ExplainMode = 'every' | 'important' | 'mistakes' | 'manual'

// ---------- Models (LLM + TTS catalog) ----------

export interface HardwareInfo {
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  ramGb: number
  freeDiskGb: number
  gpus: { name: string; vramGb: number | null }[]
  acceleration: ('cuda' | 'vulkan' | 'metal' | 'cpu')[]
}

export interface ModelFile {
  url: string
  /** Path relative to the model's install directory. */
  path: string
  sizeBytes: number
  sha256?: string
}

export interface LlmCatalogEntry {
  id: string
  name: string
  family: string
  params: string
  quant: string
  license: string
  sizeBytes: number
  /** Documented memory needed to load the model with a 8k context. */
  minMemoryGb: number
  contextLength: number
  languages: string
  notes: string
  file: ModelFile
}

export type InstallState = 'not_installed' | 'downloading' | 'installed' | 'broken' | 'incompatible'

export interface InstallStatus {
  id: string
  state: InstallState
  sizeBytes: number
  message?: string
}

export interface Recommendation {
  id: string
  role: string
  reason: string
}

export interface DownloadProgress {
  /** Stable id of the thing being installed, e.g. "stockfish", "llm:qwen...", "tts:kokoro". */
  id: string
  label: string
  receivedBytes: number
  totalBytes: number
  phase: 'downloading' | 'verifying' | 'extracting' | 'done' | 'error' | 'cancelled'
  message?: string
}

// ---------- TTS ----------

/** Registered speech engines. 'qwen3' is reserved for the planned high-quality engine (see docs/TTS.md). */
export type TtsEngineId = 'kokoro' | 'qwen3'

export interface TtsVoice {
  id: string
  engine: TtsEngineId
  name: string
  gender: 'male' | 'female'
  accent: string
  description: string
}

export interface TtsEngineInfo {
  id: TtsEngineId
  name: string
  tier: 'fast' | 'balanced' | 'highest'
  license: string
  description: string
  sizeBytes: number
  minMemoryGb: number
  needsGpu: boolean
  state: InstallState
  message?: string
  /** Measured on this machine: seconds of audio produced per second of compute. */
  measuredSpeed?: number | null
}

export interface TtsRequest {
  text: string
  engine: TtsEngineId
  voice: string
  speed: number
  /** Free-text delivery hint, used by engines that support instructed speech. */
  style?: string
}

export interface TtsAudio {
  /** 16-bit PCM WAV bytes. */
  wav: Uint8Array
  sampleRate: number
  durationSec: number
  generationMs: number
}

// ---------- Settings ----------

export interface Settings {
  setupComplete: boolean
  theme: 'dark' | 'light'
  boardTheme: string
  pieceSet: string
  showCoordinates: boolean
  showBestArrow: boolean
  /** Board sounds for moves, captures, checks, castling and the end of the game. */
  sounds: boolean
  boardSize: number
  engine: EngineOptions
  presets: ReviewPreset[]
  defaultPreset: ReviewPreset['id']
  liveMultipv: number
  liveDepth: number
  thresholds: ClassificationThresholds
  provider: ProviderConfig
  providers: Partial<Record<ProviderKind, ProviderConfig>>
  skillLevel: SkillLevel
  language: string
  coachId: string
  explainMode: ExplainMode
  autoExplain: boolean
  autoSpeak: boolean
  muted: boolean
  volume: number
  speechSpeed: number
  ttsEngine: TtsEngineId
  ttsQuality: 'fast' | 'balanced' | 'highest'
  coachChangesVoice: boolean
  /** Voice kept for every coach while coachChangesVoice is off. */
  pinnedVoice: string | null
  /** Per-coach voice override: coachId -> voice id for the active engine. */
  voiceOverrides: Record<string, string>
  customSystemPrompt: string | null
  allowNetwork: boolean
}
