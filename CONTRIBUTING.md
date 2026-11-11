# Contributing

Thanks for helping. A few things keep the project healthy.

## Setup

`npm install`, then `npm run dev`. Run `npm test` and `npm run typecheck` before opening a pull
request. Set `STOCKFISH_PATH` to include the real-engine tests.

## Rules that are not negotiable

1. **Chess facts come from Stockfish and the rules engine, never from a language model.**
   Classifications, evaluations and best moves are computed in `src/shared/classify.ts`.
2. **No fake functionality.** No mock data in shipped code paths, no buttons that do nothing.
   If something is not implemented, leave it out and say so in the README.
3. **Local-first.** No telemetry, no new network destinations without a documented reason; add
   any new download host to the allow-list in `src/main/system/download.ts` and to
   `docs/PRIVACY.md`.
4. **Licences.** New dependencies and model weights must be compatible with GPL-3.0-or-later
   distribution. Record them in `THIRD_PARTY.md`. Weights with non-commercial terms are not
   accepted as defaults.
5. **No proprietary assets.** Do not add Chess.com or other third-party artwork, piece sets,
   sounds or icons without a licence that permits redistribution.

## Where things go

- Pure logic: `src/shared/` with a test in `tests/`.
- A new AI provider: implement `ChatProvider` in `src/main/ai/providers.ts`.
- A new voice engine: implement `TtsEngine` and register it in `src/main/tts/service.ts`.
- A new coach: add `coaches/<id>/coach.json` and `prompt.md`, and list the id in
  `coaches/index.json`. Give it a voice no other built-in coach uses.

## Style

TypeScript strict mode. Explain *why* in comments, not what. Keep user-facing text plain:
name the thing, say what happened, say what to do next.
