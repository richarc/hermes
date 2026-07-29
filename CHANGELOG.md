# Changelog

All notable changes to Hermes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- File → New (⌘N) starts a fresh untitled document, guarded by the
  unsaved-changes prompt.
- File → Open Recent submenu listing recent files (with Clear Recents),
  kept in sync as documents are opened and saved — recents are now
  reachable after the welcome pane is gone.

### Fixed

- Window corners now match the standard macOS radius; the template's
  translucent backdrop had been drawing macOS 26's oversized glass corners
  (and was invisible anyway behind the app's opaque background).
- PDF export now defaults to portrait orientation (was landscape), with a
  File → PDF Orientation menu (Portrait/Landscape radio choice, persisted
  across launches).
- The app now identifies as "Hermes Editor" (bundle id `com.hermes.editor`)
  in the menu bar and About dialog instead of the template's "My Product".
- Toolbar buttons (Open / Save / Export PDF) no longer sit under the macOS
  traffic-light window controls; the toolbar is inset to clear them.
- Chart lifecycle: Vega views are finalized when their chart leaves the
  document (previously leaked listeners/timers over long sessions), and
  overlapping preview re-renders can no longer interleave chart hydration
  passes.

## [0.1.0] - 2026-07-28

First working release: an academic markdown editor with live rendering and PDF export.

### Added

- Split-view editing: CodeMirror 6 editor with markdown syntax highlighting on the left, live preview on the right, draggable divider (20–80% clamp).
- Live preview pipeline (`markdown-it`, ~250 ms debounce) with document typography; raw HTML in documents stays escaped (`html: false`).
- LaTeX math via KaTeX: `$..$` inline and `$$..$$` display; invalid LaTeX renders as a visible inline error instead of breaking the preview.
- Vega-Lite charts from ` ```vega-lite ` fenced code blocks, hydrated to live SVG with a per-spec cache (unchanged charts are moved, not re-rendered); malformed specs render an error card in place.
- File handling through native macOS dialogs: Open (⌘O), Save (⌘S), Save As (⇧⌘S), a persisted recent-files list surfaced on launch, and a "New document" escape from the welcome pane.
- Dirty tracking with a status-bar indicator and a Save / Don't Save / Cancel confirmation when closing with unsaved changes.
- PDF export (⌘E or toolbar) via the native print panel, with a print stylesheet: editor chrome hidden, 2 cm page margins, no page breaks inside formulas or charts.
- Native application menu (App/File/Edit/Window) wired to the frontend over Wails events.
- External links in the preview open in the system browser instead of navigating the app.

### Fixed

- KaTeX plugin CJS/ESM interop difference between the browser and the test runner that left the app unable to mount.
- Vite 8 (rolldown-vite) corrupting KaTeX's lexer regexes (lone-surrogate escapes re-emitted as invalid bytes), which broke multi-letter commands like `\rho` and `\mathcal`; pinned to Vite 7.
- KaTeX stylesheet not loading under the dev server; now imported through the module graph.
- Dark-mode color inversion: the app now pins a light scheme (white background, black text).
