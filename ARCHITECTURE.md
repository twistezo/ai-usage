# Architecture

## The stack

| Part | Technology |
|---|---|
| App shell, windows, tray, timer | Tauri 2, Rust |
| Views (panel, window, settings, help) | TypeScript, plain DOM, CSS, Vite |
| Page scripts (inside the sites) | Plain JavaScript |
| Icons | Tabler Icons |
| Tests | Vitest with happy-dom, `cargo test` |
| CI | GitHub Actions |

## The windows

```text
Rust ──┬── tray icon ──► panel ── Window ──► standalone window
       │                     └── Settings ──► providers on / off, open at login (LaunchAgent)
       ├── timer 60 s (paused after 15 min without input)
       ├── reader windows (hidden)  ──► chatgpt.com, claude.ai
       └── login windows            ──► chatgpt.com, claude.ai
```

Panel and window run the same page; reader and login windows have no command permissions and share one WebKit store. A provider turned off in Settings is hidden and gets no reader window.

## The reading flow

```text
timer ──► no mouse, trackpad or keyboard input for 15 min? ── yes ──► skip this tick
  │ no
  ▼
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
older than 5 min  ──► "Outdated" (also after an idle pause, until the next tick)
```

## The credentials

Session cookies live in the app's WebKit store (`~/Library/HTTPStorages/com.twistezo.ai-usage.binarycookies`), protected only by the macOS account; the Codex token stays in page memory for one read. Nothing goes to Keychain or leaves the page.
