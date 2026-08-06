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

## v0.4.0 — Navigation and reading comfort ✅ (released 2026-08-05)

- [x] Bug: there is no discoverable way to open a document that is not already
      in the recents list. The startup pane offers recent files and a "New
      document" button only. The toolbar's Open button does exist, but
      `.welcome` is an opaque full-window overlay (`position: absolute;
      inset: 0`) that covers the toolbar, so the sole route to an arbitrary
      file is File → Open… (⌘O) in the menu bar — which is installed at
      startup but invisible from that screen. Fix by adding an Open button
      beside "New document", or by letting the welcome pane sit below the
      toolbar instead of over it.
- [x] Optional scroll sync between the editor and preview panes, so the
      preview follows the editor as it scrolls. Off by default, with a
      user-visible toggle. Open design questions to settle first: where the
      toggle lives (a View menu, or the toolbar); whether the choice persists
      across sessions as the PDF orientation setting does; whether sync is
      one-way (editor drives preview) or bidirectional; and how source
      position maps to rendered position when the two heights diverge sharply
      — charts, math blocks, and tables all render far taller or shorter than
      their markdown.
- [x] Editor formatting commands: select text and apply markdown formatting —
      put the cursor on a line and make it a heading, select a block and make
      it a list, select a phrase and make it bold. Nothing off the shelf does
      this (`@codemirror/lang-markdown` ships only list-continuation
      commands), so it is hand-rolled as pure `StateCommand`s in
      `lib/markdownCommands.ts`, keeping `Editor.svelte` a thin passthrough
      and the logic headlessly testable. Block commands (headings, lists,
      quote) and inline commands (bold, italic, code) stay separate
      primitives; each action is one transaction, so it is one undo step and
      gets multi-cursor support for free. Detection is hybrid: the syntax tree
      reliably identifies fenced code — guarding the case where formatting
      inside a `vega-lite` block would corrupt the chart — but it misreads
      frontmatter as a setext heading, so that needs an explicit line-based
      guard. Citations needed no guard: wrapping one in `**…**` still
      resolves. Design:
      [docs/superpowers/specs/2026-07-31-formatting-commands-design.md](docs/superpowers/specs/2026-07-31-formatting-commands-design.md).
      Shortcut ownership turned out to be split, not exclusive: `menu.go` owns
      the accelerators, but CodeMirror's `defaultKeymap` claims ⌘I
      (`selectParentSyntax`) and ⌘⇧K (`deleteLine`) inside the webview before
      AppKit's menu ever sees them, so `Editor.svelte` re-binds those two at
      `Prec.highest`.
- [x] New documents start from a template: File → New pre-populates the
      document with a frontmatter block and short comments explaining how to
      point it at a `.bib` file and choose a citation style, so the
      bibliography feature is discoverable without reading the README. Two
      implementation notes found while scoping it. First, the guidance should
      be written as YAML `#` comments *inside* the `---` block rather than
      HTML comments: the renderer runs markdown-it with `html: false`, so
      `<!-- ... -->` would be escaped and show up as literal text in the
      preview, whereas the frontmatter block is stripped wholesale and
      `parseFrontmatter` already ignores any line that is not `key: value`.
      Second, `dirty` is derived as `content !== savedContent` and File → New
      currently resets `savedContent` to `''`, so a templated document would
      be born dirty and prompt on close despite the user never touching it —
      `savedContent` should be seeded with the template instead. Keep the
      template short enough to delete in one motion for users who do not want
      citations.

## v0.5.0 — Dark theme ✅ (released 2026-08-06)

- [x] Dark theme (theme-aware app chrome, preview, and CodeMirror theme) —
      v0.1 deliberately pins a light scheme. Moved up from the backlog, then
      out of v0.4 on 2026-08-04 to keep that release to the startup route,
      the new-document template, and scroll sync. Scoping notes from the
      pre-v0.4 review (finding A4,
      [docs/superpowers/reviews/2026-08-04-pre-v0.4-review.md](docs/superpowers/reviews/2026-08-04-pre-v0.4-review.md)):
      it touches four layers, and the least obvious one is the print
      stylesheet, which must keep rendering light or exported PDFs come out
      dark. `public/style.css` hardcodes ~20 colours and pins
      `:root { color-scheme: light }`; `Editor.svelte` adds no CodeMirror
      theme at all, so the editor stays light unless one is added; and
      `main.go` hardcodes `BackgroundColour: NewRGB(255, 255, 255)`, which
      flashes white on launch in dark mode. The System/Light/Dark choice
      itself is now cheap: `Settings` takes a field, a default, and a clamp.

## v0.6.0 — Vega-Lite

Charts get the attention citations got in v0.3: the release is entirely about
making Vega-Lite usable without hand-writing a spec.

- [ ] Implement a Vega-Lite builder for importing data and creating the chart
      graphically.

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
- Security hardening for third-party documents. A `.md` file can cause the app
  to make a network request on open, with no click and no prompt: a
  `vega-lite` block whose spec carries `data.url` is fetched by `vega-loader`
  the moment the preview renders, and `embedChart` passes no loader
  restriction. A URL alone leaks that the document was opened, and from which
  IP. The webview also sets **no Content-Security-Policy**, so the same is true
  of any other remote reference a document can express — a remote `<img>`, for
  instance. A `default-src 'self'` policy, with an explicit allowance for the
  Zotero picker on `127.0.0.1:23119`, would close the whole class in one
  change. It needs a decision first, though: it would also block remote chart
  data and remote images, which some users legitimately want, so the useful
  version is probably a setting — off by default for safety, or on by default
  with a per-document prompt.
  Audited 2026-08-06: this is the *only* way Hermes reaches the network beyond
  the Zotero picker. No `fetch`, `XMLHttpRequest` or `WebSocket` anywhere in
  `frontend/src`; one `http.Client` in Go, pointed at localhost. The ~60 URLs
  in the bundle are identifiers (XML namespaces, CSL style IDs, ORCIDs), not
  endpoints, and are never fetched.
- Create a new button style, one that is more readable and more prominent but
  compatible with both the light and dark modes.
- ~~Two document types: single-file, and a multi-part type living in a
  directory.~~ **Dropped 2026-08-06.** Hermes stays single-file. The research
  found the deciding question was not "one file or many" but what the preview
  shows while you edit one part, and that the honest cost was not the
  rendering: scroll sync's anchors are a flat integer line space that would
  need a second dimension, `dirty` is one buffer against one saved copy, the
  bibliography watcher is explicitly a single watcher, and picking a part needs
  a file-tree pane that is probably larger than all the rendering work
  combined. Two document types also means two code paths through save, dirty,
  watch, sync and export, tested twice, forever. The organisational problem it
  was meant to solve is being approached instead by making long blocks
  collapsible in the editor.

### Deferred review findings

Real findings from the v0.4 and v0.5 code reviews, judged not to block those
releases. Recorded so they are not rediscovered from scratch:

- Bug: ⌘Z immediately after File → New restores the previous document's text
  while `path` is already `null`, so a following ⌘S runs Save As and writes the
  old document's content to a new file. `setContent` dispatches an ordinary
  undoable transaction and never clears CodeMirror's history. This predates
  v0.4, but ⌘N used to leave an empty editor where undoing was obviously a
  mistake; it now produces a template, which makes the undo look legitimate.
  The one deferred item with real teeth.
- Enforce the duplicated window background. The dark `--bg` is written both in
  `frontend/public/style.css` and in `main.go` as an `NewRGB` triple, because
  Go cannot read the CSS, and nothing checks that they agree — they have
  already drifted twice. A Go test parsing `--bg` out of the stylesheet and
  comparing it against both triples would close it.
- Scroll-sync anchor density is sparser inside blockquotes and list items: the
  markdown-it core rule stamps `data-source-line` on top-level blocks only, so
  a long list is one anchor rather than several. Interpolation keeps this
  near-exact for uniform content; it degrades only when a list item contains a
  chart or a large image.
- `App.svelte` schedules a `requestAnimationFrame` for scroll sync and never
  cancels it on unmount. Latent only — `App` is the root component and is never
  unmounted in production — but it becomes real the moment that component gains
  any other teardown.
- `Editor.topVisibleLine()` has no test, and the reviewer argued *against*
  adding the obvious one: under jsdom `posAtCoords` returns null so the
  function always yields 1, which is also what the happy path returns for
  offset 0 — a test asserting 1 would pass against an implementation that
  dropped the null check entirely. Testing it honestly needs a real layout
  engine.
