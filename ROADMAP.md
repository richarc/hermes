# Hermes Roadmap

Hermes is a desktop editor for writing academic papers in markdown, with LaTeX
math and Vega-Lite charts rendered live and exported to PDF. Releases follow
[Semantic Versioning](https://semver.org); see [CHANGELOG.md](CHANGELOG.md) for
what has shipped.

## v0.1.0 — Core editor ✅ (released 2026-07-28)

The working foundation: split-view editing with live preview (markdown +
KaTeX math + Vega-Lite charts), native file handling with recents and dirty
tracking, and PDF export via the print panel. Design and plan documents live in
`docs/superpowers/`.

## v0.2.0 — Refinements and fixes ✅ (released 2026-07-29)

Everything below shipped except the Vite 8 revisit, which moved to the
backlog (blocked on an upstream Rolldown fix):

- [x] Bug: the Open / Save / Export PDF toolbar buttons overlap the standard
      macOS window controls (traffic lights). Fixed by insetting the toolbar's
      left padding to clear them (hidden-inset title bar retained).
- [x] Chart lifecycle polish: Vega views are now `finalize()`d when their
      chart leaves the document, and hydration passes are generation-guarded
      so rapid re-renders can't interleave (charts.ts hydrator factory).
- [x] In-session file navigation: File → New (⌘N) and a File → Open Recent
      submenu (with Clear Recents) that rebuilds as the list changes.
- [x] Bug: the app was named "My Product" in the menu bar and About dialog.
      Renamed to "Hermes Editor" (bundle id com.hermes.editor, © Hermes) and
      regenerated all platform build assets.
- [x] Bug: printing / PDF preview defaulted to landscape. Portrait is now the
      default, with a persisted File → PDF Orientation menu choice.
- [x] Bug: the window corner radius was noticeably larger than other macOS
      apps — the template's translucent backdrop drew macOS 26's oversized
      glass corners. Switched to a normal backdrop (opaque app anyway).
- [x] Dirty-state edge case: dirty is now derived from a comparison with the
      last-saved content instead of a sticky flag.
- [x] Keyboard accessibility for the pane divider (WAI-ARIA window splitter:
      focusable, arrow-key resizing).
- [x] Stripped unused template assets from `frontend/public/`.
- [x] Docs: corrected the stale `data-wml-openURL` note in CLAUDE.md.

## v0.3.0 — Citations and bibliography ✅ (released 2026-07-30)

The headline academic feature (previously referred to as "v2") shipped in
full, plus Zotero integration that was not in the original sketch:

- [x] BibTeX support: a `.bib` file per document, named in frontmatter and
      resolved relative to the document.
- [x] `[@key]` citation syntax rendered in the preview and in the PDF,
      including multi-cite, narrative, suppressed-author, and locator forms.
- [x] Bibliography generation via citeproc with five bundled CSL styles
      (APA, Chicago author-date, IEEE, Vancouver, Harvard).
- [x] Zotero / Better BibTeX integration: CAYW picker insertion (⌘⇧C) and a
      watched `.bib` that refreshes the preview on auto-export.

## v0.4.0 — Navigation and reading comfort

- Bug: there is no discoverable way to open a document that is not already in
  the recents list. The startup pane offers recent files and a "New document"
  button only. The toolbar's Open button does exist, but `.welcome` is an
  opaque full-window overlay (`position: absolute; inset: 0`) that covers the
  toolbar, so the sole route to an arbitrary file is File → Open… (⌘O) in the
  menu bar — which is installed at startup but invisible from that screen.
  Fix by adding an Open button beside "New document", or by letting the
  welcome pane sit below the toolbar instead of over it.
- Optional scroll sync between the editor and preview panes, so the preview
  follows the editor as it scrolls. Off by default, with a user-visible
  toggle. Open design questions to settle first: where the toggle lives (a
  View menu, or the toolbar); whether the choice persists across sessions as
  the PDF orientation setting does; whether sync is one-way (editor drives
  preview) or bidirectional; and how source position maps to rendered
  position when the two heights diverge sharply — charts, math blocks, and
  tables all render far taller or shorter than their markdown.

- [x] Editor formatting commands: select text and apply markdown formatting —
  put the cursor on a line and make it a heading, select a block and make it a
  list, select a phrase and make it bold. Nothing off the shelf does this
  (`@codemirror/lang-markdown` ships only list-continuation commands), so it is
  hand-rolled as pure `StateCommand`s in `lib/markdownCommands.ts`, keeping
  `Editor.svelte` a thin passthrough and the logic headlessly testable. Block
  commands (headings, lists, quote) and inline commands (bold, italic, code)
  stay separate primitives; each action is one transaction, so it is one undo
  step and gets multi-cursor support for free. Detection is hybrid: the syntax
  tree reliably identifies fenced code — guarding the case where formatting
  inside a `vega-lite` block would corrupt the chart — but it misreads
  frontmatter as a setext heading, so that needs an explicit line-based guard.
  Citations needed no guard: wrapping one in `**…**` still resolves. Design:
  [docs/superpowers/specs/2026-07-31-formatting-commands-design.md](docs/superpowers/specs/2026-07-31-formatting-commands-design.md).
  Shortcut ownership turned out to be split, not exclusive: `menu.go` owns the
  accelerators, but CodeMirror's `defaultKeymap` claims ⌘I (`selectParentSyntax`)
  and ⌘⇧K (`deleteLine`) inside the webview before AppKit's menu ever sees them,
  so `Editor.svelte` re-binds those two at `Prec.highest`.

- New documents start from a template: File → New pre-populates the document
  with a frontmatter block and short comments explaining how to point it at a
  `.bib` file and choose a citation style, so the bibliography feature is
  discoverable without reading the README. Two implementation notes found while
  scoping it. First, the guidance should be written as YAML `#` comments
  *inside* the `---` block rather than HTML comments: the renderer runs
  markdown-it with `html: false`, so `<!-- ... -->` would be escaped and show
  up as literal text in the preview, whereas the frontmatter block is stripped
  wholesale and `parseFrontmatter` already ignores any line that is not
  `key: value`. Second, `dirty` is derived as `content !== savedContent` and
  File → New currently resets `savedContent` to `''`, so a templated document
  would be born dirty and prompt on close despite the user never touching it —
  `savedContent` should be seeded with the template instead. Keep the template
  short enough to delete in one motion for users who do not want citations.

- Dark theme (theme-aware app chrome, preview, and CodeMirror theme) — v0.1
  deliberately pins a light scheme. Moved up from the backlog.

## Backlog (unscheduled)

Ideas noted along the way, not yet committed to a release:

- Revisit Vite 8 once the upstream Rolldown lone-surrogate bug is fixed
  (v0.1 pinned Vite 7 to keep KaTeX's lexer intact).
- File a Wails issue for the hardcoded landscape print orientation (their
  code carries a TODO inviting a config option; Hermes ships its own print
  path meanwhile).
- Dialog-free PDF export (e.g. headless rendering) if the print panel proves
  clunky.
- Windows/Linux support (paths, menus, and print behavior are currently
  macOS-focused).
- Security hardening for third-party documents (Vega-Lite specs can trigger
  remote `data.url` fetches).
