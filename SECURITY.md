# Security

## Reporting

Please report vulnerabilities privately through the repository's "Report a vulnerability"
(GitHub security advisories) form rather than a public issue. Include steps to reproduce.

## Things worth knowing

- The app downloads and runs one native program: Stockfish, from the official GitHub releases,
  verified against the SHA-256 digest GitHub publishes for the release asset. A build with no
  published digest is refused.
- Model files are verified against pinned SHA-256 values before first use.
- Installers are currently **unsigned**; your operating system will warn about that.
- "Choose engine file" runs a program you select. Only choose engines you trust.
- Imported PGN is parsed as data and never executed; coach profiles are JSON and Markdown.
- Text produced by a language model is displayed as plain text, never as HTML.
