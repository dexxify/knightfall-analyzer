# Third-party software, models and data

Knightfall Analyzer is licensed under **GPL-3.0-or-later**. That choice is driven by Chessground (GPL-3.0),
which is linked into the application. Everything bundled is compatible with it.

## Bundled in the application

| Component | Use | Licence |
|---|---|---|
| Electron | Desktop shell | MIT |
| React, React DOM | UI | MIT |
| Zustand | State | MIT |
| Tailwind CSS | Styling (build time) | MIT |
| lucide-react | Interface icons | ISC |
| @lichess-org/chessground | Chessboard | GPL-3.0-or-later |
| chess.js | Rules, PGN, move legality | BSD-2-Clause |
| fflate | Zip extraction | MIT |
| node-llama-cpp / llama.cpp | Built-in local language-model runtime | MIT |
| kokoro-js | Kokoro speech synthesis | Apache-2.0 |
| @huggingface/transformers | Model runtime used by kokoro-js | Apache-2.0 |
| onnxruntime-node | Neural network inference | MIT |
| phonemizer (eSpeak NG, WebAssembly) | Text to phonemes | GPL-3.0 |
| Cburnett chess pieces (via Chessground) | Default piece set | GPL-2.0-or-later, by Colin M.L. Burnett |
| lichess-org/chess-openings | Opening names (`resources/openings.json`) | CC0-1.0 |

The "Knightfall" and "Slate" piece sets, the board themes, the move-classification icons and the
coach avatars are original work made for this project and are covered by the project licence.

## Downloaded by the user from inside the application (not bundled)

| Component | Source | Licence |
|---|---|---|
| **Stockfish** | Official releases, `github.com/official-stockfish/Stockfish` | **GPL-3.0** |
| Qwen3.5 2B / 4B / 9B / 27B (GGUF, Q4_K_M) | `huggingface.co/unsloth/Qwen3.5-*-GGUF` | Apache-2.0 |
| Kokoro-82M v1.0 (ONNX) | `huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX` | Apache-2.0 |

### Stockfish and the GPL

Knightfall Analyzer does not link to Stockfish; it starts the official binary as a separate process and
talks to it over the UCI text protocol. Knightfall Analyzer does not redistribute Stockfish: the user
downloads the official release archive from the Stockfish project. That archive contains the
GPL text (`Copying.txt`) and a snapshot of the corresponding source code, and Knightfall Analyzer extracts
the whole archive next to the engine binary, so licence and source stay with the binary. The
complete source is always available at https://github.com/official-stockfish/Stockfish.

If you redistribute a build of Knightfall Analyzer that *includes* a Stockfish binary, you take on the
GPL obligations of distributing Stockfish yourself: ship the licence and offer the
corresponding source for that exact binary.

## Not affiliated

Knightfall Analyzer is an independent project. It is not affiliated with, endorsed by or connected to
Chess.com or Lichess. It uses only their documented public APIs, only when the user asks for
an import, and contains none of their artwork, piece sets or icons.
