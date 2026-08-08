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

## v0.6.0 — Figures and diagrams

Charts get the attention citations got in v0.3: making Vega-Lite usable
without hand-writing a spec, presenting the result as a proper figure, and
then widening what a "figure" can be beyond statistical graphics.

- [x] Implement a Vega-Lite builder for importing data and creating the chart
      graphically.
- [x] Figure presentation: captions, automatic numbering, alignment and width.
      A caption is what makes a figure — a Vega-Lite `title` or an image's
      non-empty alt text — so existing documents are untouched until their
      author adds one, and both formats stay portable through Pandoc. Charts
      and images share one number sequence in document order, recomputed each
      render. View → Figure Alignment and View → Chart Width are document-wide;
      a chart with its own `width` keeps it. Design:
      [docs/superpowers/specs/2026-08-08-chart-presentation-design.md](docs/superpowers/specs/2026-08-08-chart-presentation-design.md).
      Two limitations were accepted at review: a `title` object's `subtitle` is
      not drawn anywhere (Vega-Lite's `TitleParams` requires `text`, so a
      subtitle alone cannot render, and the design never considered folding it
      into the figcaption), and in dark mode `.vega-lite-chart`'s light card
      spans the full pane, so alignment moves the chart within the card rather
      than moving the card.
- [x] Editable chart data: reopening a chart prefills the builder's data box
      from the spec's rows, so a value can be corrected or a row added instead
      of re-pasting the whole table. Previously the box opened empty *and*
      auto-focused, so the first keystroke silently destroyed the seeded table.
      Design:
      [docs/superpowers/specs/2026-08-08-chart-data-editing-design.md](docs/superpowers/specs/2026-08-08-chart-data-editing-design.md).
      One disclosed asymmetry: the text is regenerated from the rows rather
      than stored, so charts the builder inserted round-trip exactly, but a
      hand-authored spec can shift — `{dose: '007'}` commits as `dose: 7` after
      an unrelated edit, and a sparse row commits `b: ''` where it had no key,
      which Vega-Lite draws as a point at zero rather than filtering out.
- [ ] Support additional chart types essential to physics, and to quantum
      mechanics in particular — perhaps as multiple tabs in the builder, one
      per chart family. The tabs are the easy half; the question to settle
      first is how much of the wanted list Vega-Lite can express at all. It is
      a grammar for *statistical* graphics: a polar plot is an awkward
      composition of arc marks, a contour plot needs Vega's `isocontour`
      transform rather than anything Vega-Lite offers, and 3-D surfaces,
      vector fields and Bloch spheres are outside it entirely. So the honest
      scoping question is whether this is "more builder tabs over one
      renderer" or "a second renderer alongside Vega-Lite" — and the answer
      probably differs per chart type. Worth starting from the actual list of
      plots a QM paper needs (wavefunctions with complex amplitude, probability
      densities, energy-level diagrams, Bloch spheres, band structures) and
      sorting it into what Vega-Lite can do today, what it can do with a
      hand-written spec the builder could template, and what needs something
      else. Note the builder's own constraint too: `readSpec` decides
      editability by rebuilding and comparing, so every new chart family needs
      its round trip to be exact or reopening will refuse it.
- [ ] Implement support for Mermaid diagrams. The renderer hook is the cheap
      part — intercept a ` ```mermaid ` fence the way `renderer.ts` already
      intercepts `vega-lite`, and hydrate it in `charts.ts` alongside the Vega
      views. Four things need deciding beyond that. Mermaid is a large
      dependency, so it must be dynamically imported like `vega-embed` or it
      lands in the startup bundle. It carries its own theming, which has to be
      driven from the palette and re-rendered on a theme change, and its
      output is an SVG with baked-in colours rather than something
      `style.css` can reach. It needs the same `data-source-line` treatment as
      a chart, or scroll sync loses its anchor over what is often a tall
      block. And `lib/figures.ts` currently decides figure-hood from a
      Vega-Lite `title` or an image's alt text, so a captioned diagram needs
      that extended — Mermaid has no `title` field of its own, so the caption
      has to come from somewhere new, which is the one place this feature
      cannot simply follow the chart precedent.

## v0.7.0 — Code blocks

Fenced code is the one block type Hermes renders worse than the plain
markdown it started from.

- [ ] A simple Insert menu route to a code block — one that drops a fence with
      placeholder text rather than making the author remember three backticks
      and a language tag. The wiring is the established one: a `menu:insert-code`
      event from `menu.go`, handled in `App.svelte`, writing through
      `editor.insertBlockAtCursor`, and no accelerator (an invented chord
      cannot be checked against every macOS binding — the same reasoning as
      Insert → Chart… and Blockquote). Whether it needs a *builder* like the
      chart one is worth questioning before building it: the chart builder
      exists because a Vega-Lite spec is genuinely hard to hand-write, whereas
      a code fence is a delimiter and a language name. The part with real value
      is choosing the language — a picker, not a modal.
- [ ] Syntax highlighting for code blocks. Half of this already exists and the
      other half does not, which is the thing to know going in. The **editor**
      already highlights nested languages: `Editor.svelte` configures
      `markdown({ codeLanguages: languages })` from `@codemirror/language-data`,
      so a ` ```python ` block is already coloured while you type. The
      **preview** has nothing — `renderer.ts` constructs markdown-it with no
      `highlight` option, so a fence renders as a bare `<pre><code>`. Closing
      that gap needs a highlighter chosen against this project's constraints:
      bundle size matters enough that `vega-embed` is dynamically imported, so
      whatever is picked should load the same way, and the token colours must
      go through the palette rather than a vendor stylesheet —
      `styleContract.test.ts` fails the build on a literal colour in a rule and
      requires the light, dark and print blocks to declare identical names. The
      print block is the one that catches people out: an exported PDF is always
      light, so a highlighter theming itself from the dark palette produces a
      near-white listing on paper.

## v0.8.0 — Design system

The UI has grown feature by feature; this is the release that makes it look
like one program.

- [ ] Consistent UI elements — buttons, dialogs, form controls. Today each was
      styled where it was needed: the welcome pane has its own
      `.welcome-action` rule, the chart builder its own input and select
      styling, and the modals share only `.modal`/`.modal-buttons`. Includes
      the button style carried in the backlog since before v0.5: a more
      readable, more prominent button that works in both the light and dark
      themes.
- [ ] A colour scheme for document source — markdown syntax and any embedded
      text. The mechanism exists: `style.css` defines `--syn-heading`,
      `--syn-emphasis`, `--syn-code`, `--syn-link`, `--syn-quote` and
      `--syn-meta`, and `Editor.svelte`'s CodeMirror theme reads them through
      `var()`. What is missing is a considered palette rather than an
      incidental one, and coverage: embedded languages inside a fence are
      highlighted by `@codemirror/language-data`'s own defaults, not by these
      variables, so a Python block and a heading are currently coloured by two
      unrelated schemes. Pairs naturally with v0.7's preview highlighting —
      the two should agree, so the same code looks the same in the editor, the
      preview and the PDF.
- [ ] Settle the best styling and rendering approach for the preview and the
      PDF. These are one problem, not two: the PDF is the preview under the
      `@media print` palette, printed through the system panel. The open
      questions are whether print should keep tracking the screen stylesheet
      or diverge deliberately (it already overrides the whole palette and
      hides the chrome), and whether the print panel remains the export route
      — the backlog carries a dialog-free export idea if it proves clunky.

## v0.9.0 — Bug fixes and pre-production

- [ ] Work the deferred review findings below. The ⌘Z-after-File → New bug is
      the one with real teeth: undo restores the previous document's text while
      `path` is already `null`, so a following ⌘S writes the old content to a
      new file.
- [ ] Help documentation.
- [ ] Tutorials, written using Hermes. The dogfooding is the point — a
      tutorial that cannot be written comfortably in Hermes is a bug report
      about Hermes, and the documents double as the manual visual-test corpus
      that `docs/visual-test.md` currently stands in for.

## v1.0.0 — Production

- [ ] Installable binaries, macOS only. `build/darwin/Taskfile.yml` already
      produces an `.app` bundle and ad-hoc signs it, which is enough to run
      locally and not enough to hand to anyone: Gatekeeper rejects an ad-hoc
      signature on a downloaded app. Distribution needs a Developer ID
      certificate, a hardened-runtime signature, notarization through
      `notarytool`, and stapling the ticket to the bundle — plus a decision
      about the container (a DMG is conventional; a zip is simpler and
      notarizes just as well). Windows and Linux stay in the backlog.

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
