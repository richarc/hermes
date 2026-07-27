# Hermes — Academic Markdown Editor: v1 Design

**Date:** 2026-07-27
**Status:** Approved design, pending implementation plan

## Overview

Hermes is a desktop editor for writing academic papers in markdown. Authors write
markdown with embedded LaTeX math (`$..$` inline, `$$..$$` display) and Vega-Lite
charts (` ```vega-lite ` fenced code blocks containing a JSON spec). A live preview
renders everything as they type, and the finished paper is exported as a PDF by
printing the preview.

Built on the existing Wails v3 (alpha) + Svelte 5 + Vite scaffold in this repository.

## Goals (v1)

- Edit one markdown document at a time with syntax highlighting.
- Live preview: markdown + KaTeX-rendered math + Vega-Lite charts, updating as the
  user types.
- Open/save via native dialogs; recent-files list; dirty-state tracking with a
  save/discard/cancel prompt on close.
- PDF export from the preview via the webview's print facility ("Save as PDF" in the
  macOS print dialog), with a dedicated print stylesheet.
- Bad input (invalid LaTeX, malformed Vega-Lite) renders a visible inline error;
  the rest of the document always renders.

## Non-goals (v1)

- **Citations/bibliography** (BibTeX, `[@key]`, CSL) — headline feature for v2.
- **Pandoc/LaTeX/Typst toolchains** — PDF is produced by printing the HTML preview;
  zero external dependencies by design.
- Multiple documents, tabs, or a project/folder sidebar.
- Direct (dialog-free) PDF writing — a possible v2 upgrade via headless Chrome if
  the print dialog proves clunky.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| End artifact | PDF | What authors send to supervisors/preprint servers |
| Preview model | Split view, live pane in same window | Fast feedback; PDF export is a separate explicit action |
| PDF pipeline | Print the HTML preview | Zero dependencies; preview and PDF cannot drift apart |
| Rendering location | Entirely in the frontend | KaTeX and Vega-Lite are JS libraries; Go round-trips add latency for no gain |
| Math engine | KaTeX (`throwOnError: false`) | Much faster than MathJax for live preview; coverage sufficient for paper math |
| Chart syntax | ` ```vega-lite ` fence with JSON spec | Same convention as Jupyter/Observable |
| Editor | CodeMirror 6 | Real editor ergonomics, markdown/LaTeX highlighting, performs on long documents |
| File model | Single document + recents | Covers the write-a-paper workflow without a file manager |

## Architecture

One Wails window, split into editor (left) and preview (right) with a draggable
divider. Strict division of labour:

- **Frontend (Svelte 5)** owns text and rendering: CodeMirror 6, the
  markdown→HTML pipeline, the live preview, and print-based PDF export. Document
  content lives in frontend state; keystrokes never cross the Go boundary.
- **Go backend** owns filesystem and OS integration: a `DocumentService` (native
  open/save dialogs, file read/write, persisted recent files) and the native menu
  with shortcuts (⌘O open, ⌘S save, ⇧⌘S save-as, ⌘E export PDF) that emit events
  the frontend handles.

The template's `GreetService` and time-event demo are removed.

## Components

### Frontend (`frontend/src/`)

- `Editor.svelte` — CodeMirror 6 with markdown syntax highlighting (LaTeX/JSON
  regions via CodeMirror language support); emits content changes.
- `Preview.svelte` — receives rendered HTML; hydrates Vega-Lite placeholder divs
  with `vega-embed` (charts render as SVG). Unchanged chart specs are not
  re-rendered, so typing prose doesn't flicker charts.
- `lib/renderer.ts` — pure function, markdown string in → HTML string out.
  `markdown-it` configured with a KaTeX plugin for `$..$`/`$$..$$` and a fence
  rule turning ` ```vega-lite ` blocks into placeholder divs carrying the spec.
- `App.svelte` — layout (toolbar, split pane, status bar with filename + dirty
  indicator), document state in Svelte 5 runes, wiring between menu events,
  bindings, editor, and preview.

### Backend

- `documentservice.go` — `Open()` (dialog → path + content), `Save(path, content)`,
  `SaveAs(content)`, `RecentFiles()`. Recents persisted as JSON in the OS
  app-data directory (via `adrg/xdg`, already a dependency).
- `main.go` — window setup, native menu definition, service registration.

## Data flow

**Typing:** keystroke → CodeMirror change → document state → debounce ~250ms →
`renderer.ts` → HTML → preview content swap → `vega-embed` hydrates chart
placeholders whose specs changed. KaTeX renders synchronously inside the pipeline,
so formulas appear in the same pass as text.

**Files:** menu/shortcut → Go emits event (e.g. `menu:open`) → frontend calls the
`DocumentService` binding → editor state, window title, and recents update. Dirty
tracking is frontend state; closing with unsaved changes prompts
save/discard/cancel.

## PDF export

⌘E (or toolbar button) switches the DOM to print mode via a print stylesheet:
editor/toolbar/status bar hidden, preview at full width with page margins,
print-friendly type sizes, and page-break rules (no breaks inside display formulas
or charts). Then the webview's print is triggered and the user picks "Save as PDF"
in the macOS dialog. Vega charts are SVG, so they print sharp.

**Risk / first spike:** verify how Wails v3 exposes webview printing
(`window.print()` in WKWebView vs. a Wails API). This is the first task in the
implementation plan.

## Error handling

Rule: bad input renders a visible error *in place* — never a blank or broken
preview.

- Invalid LaTeX → KaTeX `throwOnError: false` shows the raw source in red where
  the formula would be.
- Broken Vega-Lite (bad JSON or invalid spec) → that chart's slot shows an error
  card with the message; the rest of the document renders.
- File I/O failures → non-blocking toast with the OS error message.

## Testing

- `renderer.ts` — Vitest unit tests: plain markdown, inline/display math,
  vega-lite fences, malformed input.
- `DocumentService` — Go table tests for save/load/recents against a temp dir.
- Standing gate: `svelte-check` + `go build`.
- End-to-end (typing → preview → PDF) verified manually via `wails3 dev`.
