# Changelog

All notable changes to Hermes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-07-30

Citations and bibliography: the headline academic feature. Cite with Pandoc
syntax against a per-document `.bib`, and get a formatted References section
in both the preview and the exported PDF.

### Added

- Pandoc-subset citation syntax: `[@key]`, multi-cite groups
  (`[@a; @b]`), narrative citations (`@key` → "Smith (2020)"),
  suppressed author (`[-@key]`), prefixes, and page/chapter/section
  locators (`[see @key, pp. 33-35]`).
- Per-document bibliography named in YAML frontmatter (`bibliography:`),
  resolved relative to the document, parsed with Better BibTeX's own parser.
- Five bundled CSL styles selectable per document via `csl:` — APA (default),
  Chicago author-date, IEEE, Vancouver, and Harvard — with a References
  section appended to the preview and the PDF.
- Zotero integration through Better BibTeX: File → Insert Citation… (⌘⇧C) and
  a Cite toolbar button open the CAYW picker and insert the chosen keys at the
  cursor. The `.bib` is watched, so a Better BibTeX auto-export refreshes the
  preview without reopening the document.
- Sample and test documents: `docs/sample-paper.md` with `sample-paper.bib`
  exercise every citation form, entry type, and error case.

### Notes

- Unresolvable citekeys render visibly in place as `[@key?]` rather than
  blanking the preview, and inserting a key the bibliography does not contain
  now says which file was checked.
- A bibliography path is resolved relative to the document, so an unsaved
  document cannot load one; Hermes now says so instead of failing silently.
- Citation formatting uses citeproc-js, which is AGPL-3.0 licensed. The
  bundled CSL styles and locale come from the Citation Style Language project
  under CC-BY-SA-3.0 (see `frontend/src/assets/csl/LICENSE.md`).

## [0.2.0] - 2026-07-29

Quality-of-life release: in-session file navigation, proper app identity, and
a batch of macOS polish and lifecycle fixes.

### Added

- File → New (⌘N) starts a fresh untitled document, guarded by the
  unsaved-changes prompt.
- File → Open Recent submenu listing recent files (with Clear Recents),
  kept in sync as documents are opened and saved — recents are now
  reachable after the welcome pane is gone.
- The pane divider is keyboard-accessible (WAI-ARIA window splitter: Tab to
  focus, arrow keys resize).

### Changed

- The unsaved indicator now compares against the last-saved content, so
  editing back to the saved text (or emptying a never-saved document) clears
  it instead of sticking.
- Removed unused template assets from the shipped binary (background images,
  logos, bundled Inter font).

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
