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
   - `ChartBuilder.svelte`: the graphical chart editor opened from Insert → Chart… or the toolbar; pastes/imports a table via `lib/dataTable.ts` (delimited-text parsing and type inference) and encodes it with `lib/chartSpec.ts` (`buildSpec`/`readSpec`, the `BuilderState` <-> Vega-Lite JSON round trip). `App.svelte`'s `openChartBuilder`/`commitChart` decide insert-vs-replace from `Editor.svelte`'s `enclosingChartBlock`, and re-validate the target range against the live document at commit time before writing, since the modal does not block keyboard input to the editor behind it.
   - `lib/markdownCommands.ts`: editor formatting as pure CodeMirror `StateCommand`s, invoked from the Format menu via the `menu:format` event and guarded by `isProtected` so they never rewrite fenced code or frontmatter. Accelerators are owned by `menu.go`, because AppKit dispatches menu key equivalents before the webview sees them — *except* for chords CodeMirror's `defaultKeymap` already claims with `preventDefault` (⌘I is `selectParentSyntax`, ⌘⇧K is `deleteLine`). The webview wins those, so `Editor.svelte` re-binds them at `Prec.highest` and routes them back through App's `applyFormat`. Check `defaultKeymap` *and* `foldKeymap` before adding an accelerator — `foldKeymap` claims ⌘⌥[ and ⌘⌥] for folding, which the View menu reflects rather than re-binds, since the keystroke already does what the menu item says.
4. **Events (Go → JS)**: Go emits events with `app.Event.Emit(name, data)`; the frontend subscribes with `Events.On(name, cb)` from `@wailsio/runtime`. Hermes emits `menu:new`, `menu:open`, `menu:open-recent` (path payload), `menu:insert-citation` and `menu:insert-chart` (from the Insert menu), `menu:save`, `menu:save-as`, `menu:format`, and `menu:fold` (both command-name payloads) from `menu.go`; `close:confirm`, `recents:changed`, and `settings:changed` from `main.go`; and `bib:changed` from the bibliography watcher. These are plain, untyped events — there is no `application.RegisterEvent[T](name)` registration step in `main.go` (or anywhere else), so the frontend types each payload manually where it calls `Events.On`.
5. **Asset embedding**: `frontend/dist` is embedded into the binary via `//go:embed all:frontend/dist` in `main.go`, so the frontend must be built before the Go binary is (the Taskfiles handle this ordering).

Other things to know:

- App metadata (name, version, product identifier) lives in `build/config.yml`; after changing it, run `wails3 task common:update:build-assets` to regenerate build assets (this overwrites manual edits to those assets).
- Persisted preferences all live in the single `Settings` struct in `settings.go`, behind the `Settings`/`UpdateSettings` binding pair. Adding one is a field with a `json` tag, a default in `defaultSettings`, and a clamp in `normalise`; persistence, the `settings:changed` event, the menu rebuild, and the TS model all follow with no extra wiring. `settingsStore` reads the file once and writes only on a real change, so don't reach for the file directly.
- Links in the preview are intercepted by a delegated click handler in `Preview.svelte` and opened in the system browser via `Browser.OpenURL` from `@wailsio/runtime`; a plain `<a href>` click would otherwise navigate the webview away and destroy the app state.
- Colours live in one place: the custom-property palette at the top of `frontend/public/style.css`, with a `:root[data-theme="dark"]` block that must define exactly the same names. `src/lib/styleContract.test.ts` fails the build if a rule uses a literal colour or if the two blocks diverge. CodeMirror is themed through the same variables (`Editor.svelte`), so switching needs no reconfiguration. The dark `--bg` is duplicated in `main.go` as the window background because Go cannot read the CSS.
