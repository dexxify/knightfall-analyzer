# Speech engines: evaluation and status

The coach's voice is generated locally. This document records what was evaluated, what is
shipped, and what is not done yet. Licence facts were read from each project's repository and
model card on 2026-11-11; performance figures are only stated where they were measured.

## Candidates

| Project | Code licence | Weights licence | Verdict |
|---|---|---|---|
| **Kokoro-82M** (hexgrad) | Apache-2.0 | Apache-2.0 | **Shipped.** Runs in-process on ONNX Runtime, CPU only, 28 English voices. |
| **Qwen3-TTS** 12Hz 0.6B / 1.7B (Base, CustomVoice, VoiceDesign) | Apache-2.0 | Apache-2.0 | **Planned high-quality tier; not implemented.** See below. |
| **Fish Speech / OpenAudio S1** | not a standard open-source licence (GitHub reports no SPDX id) | CC-BY-NC-SA-4.0 | **Excluded.** Non-commercial weights conflict with a GPL application anyone may redistribute. |
| **F5-TTS** | MIT | CC-BY-NC-4.0 | **Excluded** for the same reason. |
| **Piper** (OHF-Voice/piper1-gpl) | GPL-3.0 | MIT for the `rhasspy/piper-voices` collection (individual voices carry their own dataset terms) | **Not shipped.** Compatible, but it fills the same "small and fast" slot as Kokoro, and each coach would need a separately vetted voice. Kokoro's quantised model already covers low-end hardware. |

## What is shipped: Kokoro

- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`, pinned to revision `1939ad2a…` and verified by
  SHA-256 on download (`src/main/tts/kokoro.ts`).
- Two quality modes: **Fast** = 8-bit quantised weights (92 MB), **Balanced** = full precision
  (326 MB). The voice style vectors ship inside the `kokoro-js` package.
- Phonemisation uses `phonemizer` (eSpeak NG compiled to WebAssembly, GPL-3.0).
- Every built-in coach is assigned a different Kokoro voice (tested: 20 coaches, 20 voices).
  A voice is a fixed style vector, so a coach sounds the same for the whole review.
- Sentence-level streaming: speech starts as soon as the first sentence of an answer is
  complete, while the model is still writing the rest.
- Measured on the development machine (Ryzen 9 9950X3D, CPU inference): full-precision model
  **9.6x faster than real time** (in-app benchmark); the quantised model measured 2.2x in a
  standalone script. The quantised model is smaller, not faster, on this processor. The app's
  "Measure speed" button records the real figure for the user's machine; no numbers are assumed.

### Limits of Kokoro, honestly

Kokoro is clear and natural but emotionally flat: it does not shout, laugh or whisper on
instruction. The Drill Sergeant does not actually bark and The Hype Man does not actually yell;
their personality comes through in the words and in the choice of voice. English only in this
build (the package validates American and British voices).

## What is not done: Qwen3-TTS

Qwen3-TTS is the right candidate for expressive, instructable voices: VoiceDesign creates a
voice from a description, and the Base model clones a reference clip, which gives a consistent
identity. Each coach profile already carries a `voice.design` description and optional
`voice.referenceClip` / `referenceText` for exactly this.

Why it is not in this build:

- The official runtime is Python + PyTorch. Shipping it self-contained means an in-app managed
  environment (the `uv` tool from Astral, a private Python, CUDA wheels): several gigabytes and
  many failure modes, none of which have been built or tested.
- A C++/GGML port exists (`ServeurpersoCom/qwentts.cpp`, MIT) with GGUF weights on Hugging
  Face, which would avoid Python entirely, but it publishes no prebuilt binaries. Using it
  means building and hosting binaries per platform in this project's release pipeline.

Intended design when it is added:

1. Register a `qwen3` engine in `src/main/tts/service.ts` (the `TtsEngine` interface is the
   only contract; the UI lists whatever is registered).
2. Run VoiceDesign once per coach to create a reference clip from `voice.design`, store it in
   the coach folder, then synthesise with the Base model cloning that clip, so the voice never
   drifts between sentences.
3. Custom voices from a user recording go through the same clone path. The coach editor
   already collects the recording, its transcript and an ownership/permission confirmation.

Until then the "Highest quality" mode is hidden in the UI rather than shown as a button that
does nothing.
