# PROJECT_PROGRESS — handover

**Knightfall Analyzer** — open-source desktop chess review: Stockfish analysis + voiced AI coaches.
Repo: https://github.com/dexxify/knightfall-analyzer · Licence: GPL-3.0-or-later.
Specs: the original "master build prompt" and its addendum (self-contained app, 20 coaches, local TTS).

Read this file first in a new session. Then `README.md` (user view) and `docs/ARCHITECTURE.md`.

## Where things stand

The app runs and the core workflow works end to end on Windows. Verified by driving the real
built app (scripts in `tests/e2e/`):

| Workflow | Result |
|---|---|
| Setup wizard: hardware detection, in-app Stockfish 19 install + test, Kokoro voice install | passed |
| Import: Lichess player API, Chess.com archive API, pasted PGN, bad-link error message | passed |
| Full-game review (33 moves, Quick preset, 3.9 s), classification, accuracy, key moments | passed |
| Move navigation, engine panel sync, variation exploration and return to the game | passed |
| AI model install through Settings (1.3 GB, interrupted and resumed, SHA-256 verified) | passed |
| Voiced coach: auto explanation, speech, speech cancelled on navigation, coach switch changes text and voice, follow-up question, pause / replay / mute, text-only mode, variation awareness | passed |
| Settings, coach, conversation and review survive a restart | passed |
| Unit tests (`npm test` with `STOCKFISH_PATH` set) | 90 / 90 |

The e2e runs above were done before the rename to Knightfall Analyzer, the new default theme
and the board sounds. After those changes only the unit tests, the type-check, the build and a
start-up smoke test were re-run.

### Not verified

- **The installer.** `npx electron-builder --dir` produced `release/win-unpacked` once (858 MB
  before trimming). After that the build config was changed (other-platform binaries excluded,
  icon added, project renamed) and it has **not been rebuilt or launched**. `tests/e2e/packaged.mjs`
  exists to test the packaged exe and has never been run. The NSIS installer itself was never built.
- **Board sounds** (`src/renderer/src/lib/sound.ts`): written, type-checks, app starts; nobody
  has listened to them.
- **The recommended 9B model.** Only the 2B model was tested. Its explanations were wordy and
  sometimes wrong about the position (for example it described a pawn capture as winning a
  queen). The 9B download was cancelled by the user at about 680 MB of 5.7 GB.
- macOS and Linux: nothing has been run there. The GitHub workflows have never run.
- Pinned-voice setting, coach import/export, backup/restore through the UI: code exists;
  backup/restore is unit-tested at the database level only.

### Not implemented

- **Qwen3-TTS** (expressive voices). Design and licence research are in `docs/TTS.md`. Kokoro is
  the only voice engine; the "Highest quality" option is hidden until an engine provides it.
- Opening Explorer, app auto-update, code signing, user-supplied piece sets, non-English speech.
- CUDA for the built-in model: node-llama-cpp only reports Vulkan here because CUDA needs the
  CUDA runtime installed, so the app uses Vulkan (Metal on macOS).

## Decisions worth knowing

- **Electron**, not Tauri (user's choice). LLM runtime (node-llama-cpp) and TTS (onnxruntime via
  kokoro-js) run in-process; no sidecar servers.
- **Classification** uses win-probability loss (Lichess curve), mates handled separately,
  thresholds configurable. Details in `docs/ARCHITECTURE.md`.
- Scores are **White-POV** everywhere; converted once in `src/main/engine/uci.ts`.
- **Chess.com single-game links need a username**: the public API has no game-by-id endpoint.
- Stockfish version is never hardcoded: latest stable GitHub release, verified with GitHub's
  asset SHA-256 digest.
- GPU memory = total minus "unified" memory, otherwise an integrated GPU inflates the number
  and a model too large for the card gets recommended.
- Downloads: HTTPS only, host allow-list, SHA-256 checked, resumable `.part` files.
- Defaults: forest board, Cburnett pieces, The Mentor, Kokoro balanced, explain every move.
- Board sounds are synthesised with Web Audio; there are no audio files to license.

## Layout

```
src/shared/    pure logic (eval, classify, pgn, material, openings, context, coach, export, api types)
src/main/      engine/ (uci, install, service) · ai/ (providers, builtin, catalog, coach-service)
               tts/ (engine interface, kokoro, service) · system/ (paths, download, hardware)
               db.ts · import.ts · coaches.ts · index.ts (window, IPC, settings, repair)
src/preload/   allow-listed bridge
src/renderer/  screens/ (Analyze, Library+Import, Coaches, Settings, SetupWizard) · components/
               lib/ (store, game, coach controller, speech queue, sound, themes, api)
coaches/       20 built-in profiles: <id>/coach.json + prompt.md, order in index.json
AI_SYSTEM_PROMPT.md   core coach prompt, loaded at runtime
resources/     openings.json (built by scripts/build-openings.mjs), icon.png
tests/         unit tests · tests/e2e/ real-app scripts
docs/          ARCHITECTURE.md, TTS.md, PRIVACY.md
```

## Commands

```
npm install
npm run dev                      # run with hot reload
npm run build                    # build into out/
npm test                         # unit tests; set STOCKFISH_PATH=<stockfish binary> for engine tests
npm run typecheck
npm run dist                     # installer into release/   (NOT yet verified)
node tests/e2e/setup.mjs  <data-dir> [shots-dir]     # wizard; downloads Stockfish + Kokoro
node tests/e2e/review.mjs <data-dir> [shots-dir]     # imports + review (uses the network)
node tests/e2e/model.mjs  <data-dir> "" "Qwen3.5 2B" 9   # install a model; rerun to resume
node tests/e2e/coach.mjs  <data-dir> [shots-dir]     # voiced coach flow (needs model + Kokoro)
node tests/e2e/packaged.mjs <exe> <data-dir>         # packaged build check (never run)
```

E2E scripts need `npm run build` first. They set `KNIGHTFALL_DATA_DIR` so they never touch the
real user data folder. The data folder used during development lived in a temporary session
folder; the first run of `setup.mjs` creates a new one.

## Suggested next steps

1. `npm run dist`, run `tests/e2e/packaged.mjs` against `release/win-unpacked/Knightfall Analyzer.exe`,
   then install the real installer on a clean machine. Check the installer size.
2. Listen to the board sounds and the coach voices; adjust.
3. Re-run `tests/e2e/review.mjs` and `coach.mjs` after the rename.
4. Install the 9B model and judge explanation quality; tune `AUTO_EXPLAIN_REQUEST`
   (`src/shared/context.ts`) and `AI_SYSTEM_PROMPT.md` against it.
5. Qwen3-TTS engine (see `docs/TTS.md`).
6. First GitHub release (workflow in `.github/workflows/release.yml`, untested).

## Known rough edges

- Mating moves are labelled "Great" when every alternative is far worse; arguably should be "Best".
- The hallucination check only catches invented move notation, not wrong prose claims.
- Explanations cached under an older prompt are reused until "Explain again" is pressed.
- The e2e scripts close their own app instance; never kill `electron.exe` by image name.
