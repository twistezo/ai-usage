# Agent notes

## With every change

- User-visible change: entry in `CHANGELOG.md` under the next version, describing what the user gets.
- Keep `help.html`, `README.md` and `ARCHITECTURE.md` true to the app.

## Release

- Version lives in `package.json` (`npm version --no-git-tag-version`), `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
- `npm run tauri build` signs ad hoc; zip with `ditto -c -k --norsrc --keepParent`.
- Release notes: the `CHANGELOG.md` section plus an Install note (Apple Silicon only, first launch via Open Anyway or `xattr -dr com.apple.quarantine`).
- The maintainer runs git and `gh`: hand over commit, tag, push and `gh release create` as one ready-to-paste command.

## Tests

Tests pin behaviour a user notices; when one exposes a bug, fix the code.
