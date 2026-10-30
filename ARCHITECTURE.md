# Architecture

## The stack

| Part | Technology |
|---|---|
| App shell, windows, tray, timer | Tauri 2, Rust |
| Views (panel, window, help) | TypeScript, plain DOM, CSS, Vite |
| Page scripts (inside the sites) | Plain JavaScript |
| Icons | Tabler Icons |
| Tests | Vitest with happy-dom, `cargo test` |
| CI | GitHub Actions |

## The windows

```text
Rust ──┬── tray icon ──► panel ── Window ──► standalone window
       ├── timer 60 s
       ├── reader windows (hidden)  ──► chatgpt.com, claude.ai
       └── login windows            ──► chatgpt.com, claude.ai
```

Panel and window run the same page; reader and login windows have no command permissions and share one WebKit store.

## The reading flow

```text
timer / Refresh ──► reader on the provider's site? ── no ──► back to the site
                            │ yes
                            ▼
                 codex.js | claude.js + report.js (fetch inside the page)
                            │
                 page title = "__AIUSAGE__" + JSON (no tokens)
                            │
                 Rust: still on the site? ── no ──► ignore
                            │ yes
                            ▼
                 "usage-report" ──► parse ──► keep last good ──► render
```

## The result states

```text
ok          ──► new reading
401 / 403   ──► "Log in to …" ──► login window ──► closed ──► reader reloads
other error ──► message, last reading kept (never 0%)
no answer in 20 s ──► "No answer from the site yet"
older than 5 min  ──► "Outdated"
```
