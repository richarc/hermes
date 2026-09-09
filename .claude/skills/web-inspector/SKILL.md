---
name: web-inspector
description: Use when profiling, debugging in Safari's Web Inspector, reading the console or network tab, or reading hermes:render User Timing measures. Explains why the production build never appears in Safari's Develop menu and how to build with DEV=true.
---

# Safari Web Inspector

- `wails3 task run DEV=true` — the build to use whenever **Safari's Web Inspector** is needed (profiling, console, network tab). The default `build` and `run` pass `-tags production`, under which Wails compiles its devtools out and `inspector_darwin.go` is excluded, so the app is absent from Safari's Develop menu however long you look. Two things have to be true for it to appear: WebKit's `developerExtrasEnabled` (Wails sets it in dev builds) and the WKWebView's `inspectable` property (Wails never sets it on macOS; `inspector_darwin.go` does, from a `WindowDidBecomeKey` hook). The first dev build recompiles every cgo object and takes ~20 minutes; after that the Go cache makes it seconds. `strings "bin/Hermes Editor" | grep -c developerExtrasEnabled` is 1 for a dev build and 0 for production. The render pipeline carries User Timing measures (`lib/perf.ts`: `hermes:render`, `hermes:preview-dom`, `hermes:hydrate-*`) — read them with `performance.getEntriesByName('hermes:render')` in the Console, since a Timeline export keeps the marks but drops the measures.
