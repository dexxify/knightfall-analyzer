# Privacy

Knightfall Analyzer is local-first. There is no account, no telemetry, no analytics and no crash reporting.

## Stored on your computer only

Games, PGN, engine analysis, coach conversations, coach profiles, settings and downloaded
models live in the application's data folder (Settings → Data & Maintenance shows the path and
opens it). API keys, if you enter any, are encrypted by your operating system's keychain.
"Delete all games" removes games, analysis and conversations. Uninstalling does not delete the
data folder; delete it yourself to remove everything.

## When the network is used

Only as a direct result of something you click:

| Action | Contacts | What is sent |
|---|---|---|
| Import from Chess.com | `api.chess.com` (official Published-Data API) | The username or archive month you asked for |
| Import from Lichess | `lichess.org` (official API) | The game, study or username you asked for |
| Install / update Stockfish | `api.github.com`, `github.com` | Nothing about you; a release file is downloaded |
| Download an AI model or voice engine | `huggingface.co` | Nothing about you; model files are downloaded |
| Check for a newer Stockfish (opening the engine panel) | `api.github.com` | Nothing about you |

Engine analysis never uses the network. Speech synthesis never uses the network.

## AI providers

The built-in model, LM Studio and Ollama run on your computer; nothing leaves it.

If you configure a provider at a non-local address, the position context (moves, evaluations,
player names from the PGN) and your questions are sent to that server each time the coach
speaks. The app shows a "Cloud AI provider in use" indicator while such a provider is selected.
No such provider is ever configured unless you do it yourself.
