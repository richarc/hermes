# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hermes is a desktop app built with **Wails v3 (alpha)**: a Go backend with a Svelte 5 + TypeScript + Vite frontend rendered in a native webview. The Go module is named `hermes`, so generated bindings live under `frontend/bindings/hermes`.

## Commands

Wails v3 uses [Task](https://taskfile.dev) for orchestration; `wails3 task <name>` and `task <name>` are equivalent. The root `Taskfile.yml` dispatches `build`/`package`/`run` to the platform-specific Taskfile in `build/<GOOS>/`.

- `wails3 dev` — run in development mode with hot reload for both Go and frontend changes (dev-mode watcher config is in `build/config.yml`)
- `wails3 build` — production build (binary goes to `bin/`)
- `wails3 package` — package a production build (e.g. a `.app` bundle on macOS)
- `wails3 task common:generate:bindings` — regenerate the TypeScript bindings in `frontend/bindings/`
- `go test ./. && go build -o /dev/null .` — run Go tests and verify build (use `.` not `./...`)
- In `frontend/`: `npm test` — run Vitest tests; `npm run check` — type-check Svelte/TS with svelte-check; `npm run build` — build frontend assets to `frontend/dist`

Server mode (no GUI, HTTP server only) is available via `wails3 task build:server` / `run:server`, and Docker variants via `build:docker` / `run:docker`.

## Architecture

The core Go↔JS boundary works like this:

1. **Services**: Go structs (e.g. `DocumentService` in `documentservice.go`) are registered in `main.go` via `application.NewService(...)` in `application.Options.Services`. Their exported methods become callable from the frontend. DocumentService handles file I/O (open, save, save-as), recent file tracking, print/export-to-PDF, and dirty tracking.
2. **Generated bindings**: `wails3 generate bindings` scans registered services and emits typed TS wrappers into `frontend/bindings/` (imported as `../bindings/hermes` in `App.svelte`). Never hand-edit these files — regenerate them after changing a service's API. The build tasks regenerate them automatically.
3. **Frontend pipeline** (editor and preview):
   - `lib/renderer.ts`: markdown-it + KaTeX plugin; renders markdown to HTML; intercepts `vega-lite` code blocks as chart placeholders.
   - `lib/charts.ts`: Vega-Embed integration; hydrates chart placeholders with live SVG charts; caches embedded specs for efficiency.
   - `Editor.svelte` / `Preview.svelte` / `App.svelte`: Svelte components; Editor contains the CodeMirror instance, Preview renders and hydrates charts in the live output, App orchestrates both panes and the surrounding toolbar/status-bar.
4. **Events (Go → JS)**: Go emits events with `app.Event.Emit(name, data)`; the frontend subscribes with `Events.On(name, cb)` from `@wailsio/runtime`. Hermes uses `menu:open`, `menu:save`, `menu:save-as` (for menu commands) and `close:confirm` (for window-close confirmations); these are plain, untyped events — there is no `application.RegisterEvent[T](name)` registration step in `main.go` (or anywhere else), so the frontend types each payload manually where it calls `Events.On`.
5. **Asset embedding**: `frontend/dist` is embedded into the binary via `//go:embed all:frontend/dist` in `main.go`, so the frontend must be built before the Go binary is (the Taskfiles handle this ordering).

Other things to know:

- The frontend uses Svelte 5 runes (`$state`, etc.).
- App metadata (name, version, product identifier) lives in `build/config.yml`; after changing it, run `wails3 task common:update:build-assets` to regenerate build assets (this overwrites manual edits to those assets).
- Links in the preview are intercepted by a delegated click handler in `Preview.svelte` and opened in the system browser via `Browser.OpenURL` from `@wailsio/runtime`; a plain `<a href>` click would otherwise navigate the webview away and destroy the app state.
