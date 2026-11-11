# Architecture

## Stack and why

| Choice | Reason |
|---|---|
| **Electron** (not Tauri, as first suggested) | The project owner chose it. It also lets the language-model runtime (llama.cpp via `node-llama-cpp`) and the speech runtime (ONNX Runtime) run inside the app's own process, so the built-in AI needs no sidecar server, port or second installer. Cost: a larger installer and more memory than Tauri. |
| React 19, TypeScript, Vite (electron-vite), Tailwind 4, Zustand | Conventional, well-maintained UI stack. |
| Chessground | The Lichess board: drag, click, arrows, animation. It is GPL-3.0, which sets the project licence. |
| chess.js | Rules, legality, SAN/UCI, PGN. |
| SQLite through Node's built-in `node:sqlite` | No native module to compile or ship. |
| Stockfish as a separate process over UCI | Keeps the engine independent of the UI and keeps the GPL boundary clean. |

## Layout

```
src/shared/     Pure logic, no Node or DOM APIs. Unit-tested.
  eval.ts         Score type helpers, win probability, White-POV normalisation
  classify.ts     Move classification, accuracy, review assembly
  pgn.ts          PGN splitting/parsing, SAN conversion
  material.ts     Material count, sacrifice detection
  openings.ts     Opening identification from resources/openings.json
  context.ts      Structured coach context + hallucination check
  coach.ts        Coach profile type, prompt composition, speech text, sentence streaming
  export.ts       Annotated PGN export
  api.ts          The typed contract between UI and main process
src/main/       Electron main process
  engine/         uci.ts (protocol), install.ts (official download + verify), service.ts (review + live)
  ai/             providers.ts, builtin.ts (llama.cpp), catalog.ts (models + recommendations), coach-service.ts
  tts/            engine.ts (interface), kokoro.ts, service.ts
  system/         paths.ts, download.ts (allow-listed, hashed, resumable), hardware.ts
  db.ts           SQLite schema, migrations, backup/restore
  import.ts       Chess.com Published-Data API and Lichess API
  coaches.ts      Coach profile storage, import/export, custom coach generation
  index.ts        Window, IPC registration, settings, repair
src/preload/    The only bridge into the sandboxed UI: invoke(channel) + on(event), allow-listed
src/renderer/   React UI: screens/, components/, lib/ (stores, speech queue, coach controller)
coaches/        Built-in coach profiles: <id>/coach.json + <id>/prompt.md
tests/          Unit tests; tests/e2e drives the real app
```

## Independence rules

- The engine layer knows nothing about the UI or the AI.
- The AI layer knows nothing about the engine. It receives a `CoachContext` object built from
  stored engine results and never writes anything back into analysis.
- The UI talks to the main process only through `src/shared/api.ts`.

## Data flow for one explained move

1. The user selects a move. `lib/game.ts` updates the cursor; the board, move list and eval bar
   render from the same state.
2. `lib/coach.ts` sees the position key change. It cancels the request in flight and stops any
   speech immediately, then waits 380 ms (so holding an arrow key does not fire a request per
   move).
3. It builds a `ContextInput` from the stored review move (or, in a variation, from live engine
   output for the position before and after) and calls `ai.explain`.
4. `CoachService` checks the explanation cache (game, coach, position, model). On a miss it
   composes the system prompt (core prompt + coach personality + trait instructions + skill
   level), renders the context as JSON, adds recent conversation turns, and streams from the
   active provider.
5. Tokens stream to the UI. A `SentenceStream` cuts them into sentences; each complete sentence
   goes to the speech queue at once, so the voice starts before the answer is finished.
6. The speech queue asks the main process to synthesise each sentence, tagged with a generation
   number. Starting a new utterance raises the generation; the main process drops older
   requests, and the player discards anything that arrives late. Speech cannot overlap.
7. The finished answer is checked: every SAN move it mentions must appear in the context it
   was given. Anything else is shown as a warning under the message.

## Evaluation conventions

- Every `Score` is from **White's point of view**. UCI reports side-to-move scores; the
  conversion happens once, in `uci.ts`.
- Mate scores are a separate variant (`{type:'mate'}`), never folded into centipawns. A
  delivered checkmate is `mate 0` with a `winner`.

## Classification

For each move: win probability for the mover with the engine's best line (before) and after the
played move, using Lichess's curve `50 + 50 * (2 / (1 + e^(-0.00368208 * cp)) - 1)`. The loss in
percentage points selects the band (defaults: Excellent ≤ 2, Good ≤ 5, Inaccuracy ≤ 10,
Mistake ≤ 20, else Blunder). Overrides, in order:

- **Forced**: only one legal move.
- **Brilliant**: engine's first choice, material offered (a simple exchange count finds a piece
  left capturable for a net loss of 2+ points), position not lost afterwards, not already
  trivially won, and the second line at least 2 points worse.
- **Great**: engine's first choice and the second line at least 10 points worse; not a plain
  recapture.
- **Book**: the resulting position is in the opening table and the move lost little.
- **Missed win**: was winning (≥ 80%) and no longer is, without becoming lost.
- Mates: keeping the fastest mate is Best; a slower forced mate is Excellent or Good.

Accuracy per move: `103.1668 * e^(-0.04354 * loss) - 3.1669`. Game accuracy: mean of a
volatility-weighted average and the harmonic mean, per colour (Lichess's published method).

## Review performance

Two engine processes: one for full-game review, one for the position on screen, so browsing
stays responsive during a review. Each position is searched to the preset depth or time limit.
Results are cached in SQLite by engine name, FEN and limits, so repeating a review is instant.

## Security

Context isolation and sandbox are on; the UI has no Node access. IPC channels are allow-listed
and only accepted from the app's own window. The engine is started without a shell and only
receives validated FENs. Downloads are HTTPS-only from a short host allow-list and verified by
SHA-256 before use. API keys are encrypted with the operating system keychain (`safeStorage`).
Navigation and new windows are blocked.
