# CLAUDE.md

## Project Overview

Hermes is a desktop app built with **Wails v3 (alpha)**: a Go backend with a Svelte 5 + TypeScript + Vite frontend rendered in a native webview. The Go module is named `hermes`, so generated bindings live under `frontend/bindings/hermes`.

## Commands

Wails v3 uses [Task](https://taskfile.dev) for orchestration; `wails3 task <name>` and `task <name>` are equivalent. The root `Taskfile.yml` dispatches `build`/`package`/`run` to the platform-specific Taskfile in `build/<GOOS>/`.

- `wails3 task common:generate:bindings` — regenerate the TypeScript bindings in `frontend/bindings/`
- `go test ./. && go build -o /dev/null .` — run Go tests and verify build (use `.` not `./...`)

## Architecture

The core Go↔JS boundary works like this:

1. **Services**: Go structs (e.g. `DocumentService` in `documentservice.go`) are registered in `main.go` via `application.NewService(...)` in `application.Options.Services`. Their exported methods become callable from the frontend.
2. **Generated bindings**: `wails3 generate bindings` scans registered services and emits typed TS wrappers into `frontend/bindings/` (imported as `../bindings/hermes` in `App.svelte`). Never hand-edit these files — regenerate them after changing a service's API. The build tasks regenerate them automatically.
3. **Frontend pipeline** (editor and preview):
   - `lib/renderer.ts`: markdown-it + KaTeX plugin; renders markdown to HTML; intercepts `vega-lite` code blocks as chart placeholders; citations are parsed by `lib/citations.ts` (markdown-it rule + citeproc-js formatter), bibliography data comes from a frontmatter-named `.bib` read/watched through Go (`bib:changed`), and Zotero insertion uses BBT's CAYW via `PickCitations`.
   - `lib/charts.ts`: Vega-Embed integration; hydrates chart placeholders with live SVG charts; caches embedded specs for efficiency.
   - `lib/markdownCommands.ts`: editor formatting as pure CodeMirror `StateCommand`s, invoked from the Format menu via the `menu:format` event and guarded by `isProtected` so they never rewrite fenced code or frontmatter. Accelerators are owned by `menu.go`, not a CodeMirror keymap — AppKit intercepts the chord before the webview sees it.
4. **Events (Go → JS)**: Go emits events with `app.Event.Emit(name, data)`; the frontend subscribes with `Events.On(name, cb)` from `@wailsio/runtime`. Hermes uses `menu:open`, `menu:save`, `menu:save-as` (for menu commands) and `close:confirm` (for window-close confirmations); these are plain, untyped events — there is no `application.RegisterEvent[T](name)` registration step in `main.go` (or anywhere else), so the frontend types each payload manually where it calls `Events.On`.
5. **Asset embedding**: `frontend/dist` is embedded into the binary via `//go:embed all:frontend/dist` in `main.go`, so the frontend must be built before the Go binary is (the Taskfiles handle this ordering).

Other things to know:

- App metadata (name, version, product identifier) lives in `build/config.yml`; after changing it, run `wails3 task common:update:build-assets` to regenerate build assets (this overwrites manual edits to those assets).
- Links in the preview are intercepted by a delegated click handler in `Preview.svelte` and opened in the system browser via `Browser.OpenURL` from `@wailsio/runtime`; a plain `<a href>` click would otherwise navigate the webview away and destroy the app state.
