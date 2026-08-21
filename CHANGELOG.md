# Changelog

All notable changes to Hermes are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Code blocks are syntax highlighted, in the editor and the preview, from one
  shared table — so a block looks the same while you write it and after it
  renders, and the same again in an exported PDF. Around 150 languages are
  recognised, each grammar loaded only if a document uses it. Colouring is by
  token type rather than by language, so a new language needs no new colours,
  and a fence with an unknown language stays plain rather than erroring.
- Insert → Code Block writes the fence for you, from a submenu of thirteen
  languages plus plain text — so the backticks and the language tag are one
  menu choice rather than something to remember, and a misspelt tag can no
  longer leave a block silently uncoloured. The cursor lands inside the block,
  ready to type; text selected beforehand is wrapped in the fence rather than
  replaced by it.
- Two more chart marks in the builder: **tick**, which draws a short stroke at
  each point for a strip plot, and **rule**, which draws a line from the
  baseline up to each point for a spike plot. Both fit the builder's existing
  encoding, so an existing chart reopens for editing exactly as before.
- Mermaid diagrams. A ` ```mermaid ` fence renders as a diagram in the preview
  and in exported PDFs — flowcharts, sequence diagrams, state machines and the
  rest. Give the diagram a `title:` in its frontmatter and it becomes a
  numbered figure with a caption, sharing one sequence with charts and images.
  In dark mode a diagram sits on the same white card a chart does, and an
  invalid diagram shows an error card rather than breaking the preview. The
  library loads only when a document actually contains a diagram.

### Fixed

- An image stored beside the document now displays. `![Plot](fig1.png)` showed
  a broken icon: the preview resolved the path against the application's own
  bundle rather than the document's folder, so only remote images ever worked.
  Paths now resolve exactly as `bibliography:` does — relative to the
  document, with `../` and absolute paths allowed — and filenames containing
  spaces or non-ASCII characters resolve correctly.

## [0.6.0] - 2026-08-09

Charts get the attention citations got in v0.3: a graphical builder, so a
Vega-Lite spec no longer has to be hand-written, and figures — captions,
automatic numbering, alignment and width — so what the builder produces reads
as part of a paper rather than an illustration dropped into one. The app's own
chrome was given a single vocabulary along the way, ahead of its release,
because the features queued behind it all add UI.

### Added

- A chart builder, from Insert → Chart… or the toolbar. Paste a table or
  import a CSV, choose a mark and which columns map to which axis, and watch
  the chart update as you go; inserting writes a `vega-lite` block at the
  cursor with the data inlined, so the document stays self-contained. Put the
  cursor back inside that block and Insert → Chart… reopens it with the
  controls filled in and the data box holding the chart's own table, so a
  value can be corrected or a row added without re-pasting the lot. The box
  always writes that data back comma-separated, even for a chart originally
  built from a tab-separated paste — the delimiter itself isn't kept, only the
  data. A chart using anything the builder cannot express —
  layers, transforms, a hand-set `title: null` — is left strictly alone, and
  says which feature stopped it rather than failing vaguely.
- Figures: captioned, numbered, and consistently placed. A caption is what
  makes a figure — give a chart a `title` (or use the builder's new Caption
  field) or an image some alt text, and it gains a numbered caption below it,
  counted in document order across charts and images together. A block with
  no caption renders exactly as before, and an image with empty alt stays
  decorative and unnumbered. Captions are written where each format already
  keeps them — a Vega-Lite `title`, an image's alt text — so a document
  converted through Pandoc keeps them.
- View → Figure Alignment (Left, Centre, Right) and View → Chart Width
  (Small, Medium, Large) place and size every figure in the document. A chart
  that sets its own `width` keeps it. An oversized chart scales down to the
  preview pane rather than scrolling it sideways, and a caption stays on the
  same page as its figure in an exported PDF.
- Insert Citation… moved from the File menu to a new Insert menu, alongside
  Insert Chart…. ⌘⇧C is unchanged.
- Block folding is now visible in the View menu: Fold Block and Unfold Block
  (⌘⌥[ and ⌘⌥], which already worked but were undiscoverable), plus Fold All
  Code Blocks and Unfold All. Folding a `vega-lite` or code block keeps its
  opening fence line and hides the body, so a long chart spec stops crowding
  the prose around it. Fold All Code Blocks leaves headings and tables alone.
- A consistent look for the app's own controls. Every button now has real
  padding, a border, and hover, active, focus and disabled states —
  previously only the two welcome-pane buttons were styled at all. A dialog's
  confirming action is filled, so it is clear what Return does. Both dialogs
  are now built on one shell using the native `<dialog>` element, which keeps
  Tab inside them, closes on Esc, and keeps a large chart's Insert button
  visible instead of scrolling it away. Keyboard focus is visible everywhere
  it lands, including the pane divider.

### Changed

- Upgraded Wails from `v3.0.0-alpha2.118` to `v3.0.0-beta.5`, trading an alpha
  with no stability promise for a beta whose desktop API is declared stable.
  No Hermes source changed: the Go build, vet and tests pass untouched, and
  the beta CLI regenerates `frontend/bindings` byte-identically. The
  `@wailsio/runtime` dependency, previously `"latest"` and resolving one
  release *behind* the Go module, is now pinned to the exact matching version
  so the two cannot drift apart again.

### Fixed

- ⌘Q no longer discards unsaved changes. The unsaved-changes guard was
  registered on a window-closing event, and the standard Quit menu item tears
  the application down without raising one — so the prompt you get from the
  red button never appeared for the keyboard shortcut.
- Undo immediately after File → New no longer resurrects the previous
  document. It used to bring back the old text while the app already
  considered the document new, so the next save wrote the old content into a
  new file.
- Clicking Cite while full screen no longer strands you on another desktop.
  Zotero's picker has to come forward to be used, which moves you to its
  Space; Hermes now brings you back when the picker closes, whether you picked
  a citation or cancelled.
- A folded block no longer shows a light-grey placeholder in dark mode.

## [0.5.0] - 2026-08-06

A dark theme across the whole app — chrome, preview, editor, window, and the
exported PDF — chosen from View → Appearance.

### Added

- Dark theme, chosen from View → Appearance: System, Light, or Dark. System
  follows the OS appearance and changes with it. The choice is remembered
  between sessions. Charts and images keep a light background so figures stay
  readable and match the exported PDF, and PDF export is always light
  regardless of the app's appearance.

### Notes

- Both screen palettes are chosen against contrast targets — body text at or
  above 7:1, all other text at or above 4.5:1 — and a test recomputes every
  pair from the stylesheet, so a change that drops one below its target fails
  the build. Print deliberately differs from both: ink does not glare the way
  a backlit screen does, so exported PDFs keep pure black on white.

## [0.4.0] - 2026-08-05

Navigation and reading comfort: a discoverable Open, templated new documents,
and optional scroll sync — together with the fixes from a review of the whole
codebase carried out before the release.

### Added

- Editor formatting commands, available from a new Format menu: headings 1–6
  and Paragraph (⌘1–⌘6, ⌘0), bold (⌘B), italic (⌘I), inline code (⌘⇧K),
  strikethrough (⌘⇧X), bulleted and numbered lists (⌘⇧8, ⌘⇧7), and blockquote.
  Each command is a single transaction, so one ⌘Z undoes the whole action, and
  multi-cursor selections are supported.
- New documents start from a short frontmatter template that shows how to
  point at a `.bib` file and names all five citation styles, so the
  bibliography feature is discoverable without reading the README. It applies
  to File → New, the welcome pane's New document button, and a first launch
  with no recent files. An untouched template does not count as unsaved work,
  so closing straight away does not prompt.
- Formatting toggles uniformly across a selection: applying a format that every
  target line or range already has removes it, and a mixed selection resolves
  toward the requested format instead of flipping line by line. Heading and
  list markers replace one another rather than stacking.
- Formatting commands never rewrite fenced code, inline code, or the YAML
  frontmatter block, so a `vega-lite` chart spec and the `bibliography:` key
  cannot be corrupted by a stray ⌘B.
- Optional scroll sync: with View → Sync Scrolling enabled, the preview
  follows the editor as it scrolls. Off by default and remembered between
  sessions. Rendered position is derived by interpolating between the source
  lines of the surrounding blocks, so a chart or table that occupies a few
  lines of markdown and a great deal of rendered height stays aligned instead
  of drifting the rest of the document out of step.

### Changed

- The app starts with about half as much JavaScript to parse. Vega, citeproc,
  the CSL locale, and each of the five citation styles were all loaded up front
  regardless of the document, so a paper with no charts still paid for the
  chart engine and a paper using APA still carried Chicago. They now load on
  demand: the startup bundle drops from 3,104,526 to 1,529,872 bytes, with the
  rest arriving only when a chart is drawn or a bibliography is loaded.
- Persisted preferences now live in a single `Settings` value behind one
  `Settings` / `UpdateSettings` binding pair, replacing the per-preference
  getter, validating setter, and change callback that PDF orientation had to
  itself. Adding a preference is now a struct field, a default, and a clamp —
  which is what the dark theme and scroll-sync toggle will need. The settings
  file is read once and rewritten only when a value actually changes, instead
  of being re-read and re-parsed on every access including each menu rebuild,
  and re-picking the menu item that is already selected no longer rebuilds the
  menu. A single `settings:changed` event replaces the orientation-specific
  callback.
- Saving a preference reports failures instead of discarding them, so a
  choice that could not be written no longer looks like it was applied.

### Fixed

- The welcome pane now offers an Open… button. It is a full-window overlay, so
  it covered the toolbar's Open button, leaving ⌘O as the only way to reach a
  file that was not already in the recents list — and nothing on that screen
  said so.
- The welcome pane's New document button now creates a new document rather
  than just dismissing the pane.
- Recent files no longer go missing when documents are saved or opened in
  quick succession. Each call read the list, edited it, and wrote it back with
  no serialisation, so overlapping calls discarded each other's entries — a
  test firing twenty concurrent saves ended up with two entries instead of ten.
- Opening a document, or starting a new one, no longer renders the preview a
  second time 250 ms later with the same content.
- `<` and `>` in a bibliography entry no longer turn into `¡` and `¿`. A title
  such as "Behaviour of alloys at <5 degrees" appeared in the References list
  as "at ¡5 degrees", because the BibTeX parser emulates LaTeX's OT1 text
  encoding, where a bare `<` really does typeset that way. Comparison operators
  are common in medical and physical-science titles, and there was no way to
  turn the behaviour off, so the brackets are now protected across parsing.
  Titles that genuinely contain `¡` or `¿` are untouched, and LaTeX markup,
  accents, and math still convert as before.
- Typing in a document with citations no longer stalls. The citeproc engine
  was rebuilt on every preview render, and constructing one parses the whole
  CSL style — 239 ms for APA, 503 ms for Chicago, against 0.2 ms to actually
  format a citation. With the preview rendering every 250 ms, that blocked the
  editor almost continuously. The engine is now built once per bibliography
  (lazily, so a document that cites nothing never pays) and rebuilt from the
  cluster list each pass: APA renders drop to 3.2 ms and Chicago to 3.6 ms.
- Saving a document is now atomic. `Save` truncated the target file before
  writing, so an interrupted write — a full disk, a crash, a lost power supply
  — could leave a paper empty or half-written with no copy to fall back on.
  Writes now go to a temp file alongside the destination, which is fsynced and
  renamed into place, so the file on disk is only ever the old version or the
  complete new one. An existing file keeps its own permissions. The recents
  and settings files are written the same way.

### Notes

- Because an atomic save replaces the file rather than rewriting it in place,
  saving now needs write permission on the containing *directory*, not just on
  the file. A document in a directory the user cannot write to reports a save
  error instead of silently taking the unsafe path.

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
