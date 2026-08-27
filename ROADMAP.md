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

## v0.6.0 — Figures and charts ✅ (released 2026-08-09)

Charts got the attention citations got in v0.3: making Vega-Lite usable
without hand-writing a spec, and presenting the result as a proper figure.

Two items that were scoped here moved to v0.7 rather than holding the release
— more chart types and Mermaid diagrams both need a design decision before
they need code, and what had shipped was already a coherent release. The
control restyle from v0.8 went out in it too, taken early because everything
queued behind it adds UI.

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

## v0.7.0 — Code blocks and diagrams ✅ (shipped in v0.9.0, 2026-08-27)

Fenced code is the one block type Hermes renders worse than the plain
markdown it started from — plus the two items v0.6 deferred, both of which
want brainstorming before they want code.

- [x] **Bug: Export PDF truncated the document — the last page, and with it
      the References section, was missing.** Reported 2026-08-19, fixed
      2026-08-21.
      The cause was an ordering mistake inherited from Wails' own print
      implementation, not a stylesheet problem. `printWithOrientation` created
      the `NSPrintOperation` first, which makes `WKPrintingView` paginate
      against the print info we supplied; the panel was shown afterwards, the
      printer chosen there brought its own paper size and imageable area, the
      content reflowed to need more room — and the operation still rendered
      only the pages it had already counted. An 11-page count applied to a
      now-longer document dropped the tail, ending a bibliography four entries
      early. The fix is to run `NSPrintPanel` first and build the operation
      from the settings the user actually chose, so pagination cannot go stale.
      This entry previously blamed the print stylesheet's height chain
      (`html, body { height: 100% }`, `.app { height: 100vh }` never relaxed
      for paging). That was wrong and is withdrawn: relaxing it changed
      nothing, not even the page at which the document stopped. Also
      disproved along the way — the `po.view.frame = webView.bounds` override,
      a stale page range inherited from `sharedPrintInfo`, and the panel's
      Save as PDF workflow, which produced identical output to a panel-free
      direct write. What identified it was that a direct write was *complete*
      at the same page count the panel produced *truncated*: same pages,
      different content, which only a layout changing after pagination
      explains.
      Known cost: the panel no longer shows its live preview, because the
      preview is drawn by the print operation and there is no longer one in
      existence while the panel is open. `NSPrintPanelShowsPreview` on a
      standalone panel does nothing — verified. Printing to paper and Save as
      PDF both work, and the panel's PDF menu still offers Open in Preview.
      Still untested by anything automated: the print path has no coverage,
      and AppKit print operations are not exercisable headlessly. The
      regression guard is `docs/test-document.md` — export it and check the
      bibliography reaches its last entry.
- [x] **Bug: a local image beside the document did not display.** Reported
      2026-08-20, fixed 2026-08-21. The webview loads the embedded frontend
      bundle, so a document-relative `<img src>` resolved against that bundle
      and 404d; nothing had ever mapped between the two. A Wails asset
      middleware (`localimages.go`) now serves files on `/_hermes/image`, and
      `renderer.ts` rewrites a local source onto it, carrying the document and
      the source as separate query parameters so Go does the join with
      `resolveAgainstDoc` — the same resolution `bibliography:` uses, lifted
      from a `DocumentService` method it never needed to a package-level
      function so the two cannot diverge. Remote, `data:` and fragment sources
      are untouched; an unsaved document has no folder to resolve against, so
      its sources are left as written, exactly as `bibliography:` behaves.
      Two things worth keeping. markdown-it percent-encodes link destinations
      before a renderer sees them, so the source is decoded before being
      re-encoded for the query string; without that, `my figure.png` reached Go
      as `my%20figure.png` and looked for a file of that literal name — any
      space, ampersand or non-ASCII character would have failed silently. And
      `docs/test-document.md` now carries the first local-image fixture beside
      it: every image there was a remote URL, which is precisely why this
      shipped broken and why the gap would otherwise reopen.
      Numbering was deliberately left alone. An earlier draft of this entry
      claimed a broken image "consumes a number that renumbers everything after
      it" — that was wrong. `numberFigures` decides synchronously from the alt
      text and never learns whether the file loaded, so a figure's number does
      not move when a path starts working. Making broken images unnumbered
      would have introduced exactly the instability the claim imagined.
- [x] Support more Vega-Lite chart types in the builder. Shipped 2026-08-22 as
      four families behind one Chart type dropdown: **histogram** (`bin` on x,
      count on y), **heatmap** (`rect` with a quantitative colour carrying an
      aggregate), **error bars** and **pie** (`arc` with `theta` and colour,
      and no axes at all). The type is *derived* from the spec on read rather
      than stored, so a chart block stays plain portable Vega-Lite with no
      Hermes marker in it. Inference runs most-specific-first, and that order
      is load-bearing: a bar chart that counts rows but does not bin is still a
      bar chart, which is what keeps every chart in every existing document
      reopening unchanged.
      This entry over-estimated error bars, grouping them with the work that
      "needs a transform or a layer". That is true only of the decorated form —
      points drawn on top. The bare form is a single mark carrying an extent,
      which made the one family a scientific paper actually needs among the
      cheapest here rather than the most expensive.
      `BuilderState` stayed one flat shape rather than becoming a discriminated
      union: a pie's slice size lives in `y` and its category in `colour`. The
      union is the purer model and was rejected on cost — it would have
      rewritten the builder, `App.svelte` and every existing chart test for one
      family's benefit, while the rebuild-and-compare round trip that actually
      guarantees correctness is unaffected either way. Revisit if a fifth
      family also abandons `x`/`y`.
      Still out of scope, deliberately: layered charts — points over error
      bars, a regression line over a scatter — which need `layer` and
      `transform` inside the round trip, and `PASSTHROUGH_KEYS` excludes those
      because carrying them alongside the `mark`/`encoding` pair `buildSpec`
      emits would produce a spec that is not valid Vega-Lite. Also still
      skipped: `circle`, `square` and `trail`, cosmetic variants of `point` and
      `line`. And a heatmap hand-written with an `ordinal` axis renders but
      will not reopen — the builder's column types are quantitative, temporal
      or nominal only, which is the ordinary "cannot model this" refusal.
- [x] Mermaid diagrams. A ` ```mermaid ` fence is intercepted the way
      `renderer.ts` already intercepts `vega-lite` and hydrated by
      `lib/mermaid.ts`, with the library dynamically imported so a paper
      without diagrams never loads it. Each of the four things this entry
      expected to need deciding turned out to have a precedent already in the
      codebase. Captions: the entry claimed Mermaid "has no `title` field of
      its own" — it does, read from the fence's YAML frontmatter and drawn
      into the SVG exactly as a Vega-Lite `title` is, so `figures.ts` gained a
      `mermaidCaption` beside `chartCaption` and the title is stripped before
      rendering so it does not appear twice. Theming: not needed at all — the
      entry expected the palette driven into Mermaid and a re-render on every
      theme change, but charts have the identical problem and Hermes already
      answers it by putting a figure on a white card in dark mode, which
      `.mermaid-diagram` simply joins. Scroll sync: the fence renderer writes
      `data-source-line` by hand, as the chart branch does. Dependency size:
      dynamic import, as with `vega-embed`.
- [x] A simple Insert menu route to a code block. `Insert → Code Block` is a
      submenu of thirteen curated languages plus Plain text, each emitting
      `menu:insert-code` with the fence token it writes; `App.svelte` handles
      it behind the same welcome-pane and chart-builder guards as every other
      menu action, and there is no accelerator (an invented chord cannot be
      checked against every macOS binding — the same reasoning as Insert →
      Chart… and Blockquote). Not a builder: the chart builder exists because
      a Vega-Lite spec is genuinely hard to hand-write, whereas a code fence is
      a delimiter and a language name, and the only part carrying value is
      choosing the language. Curated rather than all ~150 `language-data`
      knows, which would need a filter field — the dialog this deliberately
      avoided; every token was checked to resolve through `loadGrammar`, so no
      item can offer a language that renders plain (MATLAB was dropped for
      exactly that reason). It does not write through `insertBlockAtCursor`, as
      sketched here: that leaves the cursor *after* what it inserted, stranding
      the author below the fence, and is built on `replaceSelection`, so a
      selection would be deleted rather than wrapped. A new
      `insertCodeBlockAtCursor` does both the other way round.
- [x] Syntax highlighting for code blocks. The editor loaded the grammars and
      tagged the tokens, but coloured none of them: registering any
      non-fallback highlighter displaces CodeMirror's `defaultHighlightStyle`
      entirely, and `hermesHighlight` mapped only the six markdown tags. Both
      panes showed monochrome code, so the work was additive in both — the
      **preview** had nothing at all (`renderer.ts` constructed markdown-it
      with no `highlight` option, so a fence rendered as a bare
      `<pre><code>`), and the **editor** needed a highlighter that actually
      applied colour rather than tagging alone. Both now colour a fence from
      one shared table (`syntaxTags.ts`), so a language is registered once
      rather than twice, and the same code looks the same while it's
      written, after it renders, and in an exported PDF. Token colours go
      through the palette rather than a vendor stylesheet —
      `styleContract.test.ts` fails the build on a literal colour in a rule
      and requires the light, dark and print blocks to declare identical
      names, which is what kept the print block honest: an exported PDF is
      always light, and a highlighter theming itself from the dark palette
      would otherwise have produced a near-white listing on paper.

## v0.8.0 — Design system ✅ (shipped in v0.9.0, 2026-08-27)

The UI has grown feature by feature; this is the release that makes it look
like one program.

- [x] Consistent UI elements — buttons, dialogs, form controls. One
      vocabulary now covers every button and field in the chrome: a default
      bordered style promoted from the welcome pane's old `.welcome-action`
      rule, a filled `.primary` for a dialog's confirming action, and
      `.link-button` for the recents list, each with real hover, active,
      focus-visible and disabled states — none of which existed before this
      release. `.encode-step`'s inputs and selects and the chart builder's
      textarea are promoted the same way, so a control looks the same
      wherever it appears. Both modals are now one `Dialog.svelte` on the
      native `<dialog>` element, which traps Tab, closes on Esc, and keeps a
      large chart's Insert button visible via a sticky footer instead of
      scrolling it away. Design:
      [docs/superpowers/specs/2026-08-08-ui-design-system-design.md](docs/superpowers/specs/2026-08-08-ui-design-system-design.md).
- [x] A colour scheme for document source — markdown syntax and any embedded
      text. The mechanism exists: `style.css` defines `--syn-heading`,
      `--syn-emphasis`, `--syn-code`, `--syn-link`, `--syn-quote` and
      `--syn-meta`, and `Editor.svelte`'s CodeMirror theme reads them through
      `var()`. What was missing was a considered palette rather than an
      incidental one, and coverage: embedded languages inside a fence were
      tagged but coloured by nothing at all. There were never two competing
      schemes — `hermesHighlight` has been a non-fallback highlighter since it
      was written, so `defaultHighlightStyle` was displaced from the start and
      language-data's own colours never applied. Landed together with v0.7's
      highlighting: five more
      names — `--syn-keyword`, `--syn-string`, `--syn-number`, `--syn-type`
      and `--syn-function` — now cover the token roles, comments reuse
      `--syn-meta` rather than getting a name of their own, and the same code
      looks the same in the editor, the preview and the PDF.
- [x] Settle the best styling and rendering approach for the preview and the
      PDF. The question underneath the two the roadmap named: the preview had
      no document typography at all, so a paper rendered full-bleed in the
      macOS UI font and print was a set of patches on top. The preview is now
      a page — a white sheet on a desk, `ui-serif` at 11pt/1.5, true paper
      proportions from a new `PaperSize` setting crossed with the existing
      orientation, and a 25mm margin (up from 20mm, which gave an
      ~88-character measure). The sheet stays white in dark mode, which is the
      decision the rest follows from: the document region is always light, so
      the palette splits into theme-varying chrome and an invariant `--doc-*`
      set, the fifty-line `@media print` palette override is deleted rather
      than maintained, and so are the three figure-card tokens that mounted
      transparent figures against a dark ground. Print therefore no longer
      tracks the screen stylesheet because there is nothing left to track.
      Export left the print panel too: the sheet must know its paper size to
      be drawn, which made the panel's paper picker a second source of truth
      for the same fact. Accepted limitation: A4 is ~794px, so in a split view
      the sheet is often shrunk below true size — proportions stay right, the
      absolute measure does not. Design:
      [docs/superpowers/specs/2026-08-25-preview-and-pdf-styling-design.md](docs/superpowers/specs/2026-08-25-preview-and-pdf-styling-design.md).

## v0.9.0 — Bug fixes and pre-production ✅ (released 2026-08-27)

- [x] Work the deferred review findings below. Done 2026-08-26. The three that
      lost the user's work — ⌘Q quitting without a prompt, ⌘Z after File → New
      resurrecting the previous document, and the Zotero picker stranding you
      on another Space — were fixed on 2026-08-09 rather than waiting for this
      release. Four more went in now: Insert → Chart… no longer deletes a
      selection, ⌘Q with the builder open refuses out loud instead of doing
      nothing at all, the window background is checked against the palette by a
      test rather than by eye, and the scroll-sync frame is cancelled on
      unmount. All seven are struck from the list below.
      Two entries remain there deliberately. They are not debt — they record a
      limitation and a decision not to write a particular test, and both are
      worth keeping written down so neither is rediscovered as news.
- [x] **A signed, notarized download on GitHub Releases.** Shipped 2026-08-27
      as v0.9.0. Brought forward from v1.0, because a pre-production release
      nobody can install is not one. Everything Hermes built until now was
      ad-hoc signed — enough to run locally and no use to anyone else, since a
      download carries `com.apple.quarantine` and Gatekeeper refuses an
      ad-hoc signature outright with "Hermes is damaged and can't be opened",
      which reads as broken rather than as a security prompt.
      Decisions taken: **universal, not arm64-only**, so an Intel user gets an
      app rather than a baffling failure. **A zip, not a DMG** — it notarizes
      identically and needs no layout work. **One v0.9.0 covering everything
      since v0.6.0**, rather than back-filling v0.7.0 and v0.8.0 tags: both
      were finished and never cut, and no binary had ever been downloaded, so
      intermediate tags would have been bookkeeping for an audience of
      nobody. And the bundle identifier moved to `com.qxquantum.hermes` while
      it was still cheap — settings live under an XDG `hermes/` path rather
      than the bundle ID, so nothing was stranded.
      Three traps, each of which cost real time and none of which announce
      themselves. **The certificate type**: "Apple Development" runs on your
      own machines and "3rd Party Mac Developer Application" is for the Mac
      App Store; neither is Developer ID, and the portal offers all three
      without saying so. **The intermediate**: a Developer ID certificate is
      issued by "Developer ID Certification Authority" (G2), *not* by WWDR, so
      installing it is a separate step — without it the certificate is
      present and correct while every identity reads `CSSMERR_TP_NOT_TRUSTED`
      and `security find-identity -v -p codesigning` finds nothing at all.
      **The ordering**: `codesign` seals `Contents/`, so anything touching the
      bundle afterwards invalidates it — which is why `darwin:sign:notarize`
      would have notarized a bundle with no licences (its `deps: [package]`
      resolves to the darwin Taskfile's own copy) and why running the root
      `package` after signing would have replaced the Developer ID signature
      with an ad-hoc one.
      Hence `wails3 task release` in the root Taskfile, which is the whole
      procedure in one ordered place, and `release:verify`, which asks the
      question that matters: `spctl` says "accepted, source=Notarized
      Developer ID", where `codesign --verify` alone would happily pass an
      ad-hoc signature. Hardened runtime needed no entitlements — WebKit
      starts fine under it, which was the one genuine unknown.
      Still manual and worth a CI check: `build/config.yml`'s `version` has to
      match the tag. A mismatch ships a build whose Help → Report an Issue
      form lies about which version it came from, which is the one thing that
      form exists to get right.
- [x] **A Help menu.** Shipped 2026-08-23. Hermes had none — `menu.go` added
      App, File, Edit, Insert, Format, View and Window — and Wails' `HelpMenu`
      role is no use, containing a single "Learn More" item pointing at
      wails.io, so it is built by hand. Two items: Hermes Documentation, and
      Report an Issue….
      Both open in the browser rather than in the app, which dissolved the
      question this entry previously carried about opening bundled documents
      read-only or copying them somewhere writable. A help document is not a
      document you are writing: loading one into the editor would mean
      replacing whatever is open, behind the unsaved-changes confirm, for
      something the reader only wants to read. Nothing is bundled, so there is
      nothing to keep in step with a release either.
      What that gives up is the dogfooding this release wanted — guides written
      in Hermes, doubling as the manual-verification corpus `docs/test-document.md`
      stands in for. That argument still holds and is now the docs site's to
      make: see the site item under v1.0, whose eventual ambition is that its
      pages ARE Hermes documents.
- [x] **A feedback route that works for non-technical users.** Shipped
      2026-08-23 as Help → "Report an Issue…", which opens a form in the
      browser with the Hermes version and the OS version prefilled through the
      URL. The prefilled fields are the entire reason it is in the app rather
      than being a link in the README: a report that does not say which version
      it came from usually cannot be acted on, and asking people to find that
      out is how you get no reports at all.
      The version is read from the running bundle's `CFBundleShortVersionString`
      rather than compiled in, so `build/config.yml` stays the single source
      and there is no third copy to drift from a git tag. Outside a bundle it
      reports "unknown" instead of an empty field. `feedbackURL` and
      `osDescription` are split out of the menu closure so they are testable —
      AppKit menu construction is not exercisable headlessly, the same reason
      `quitRequest` and `localImagePath` are separate from what calls them.
      **Still to do: create the hosted form** (Tally, Formspree or similar) and
      replace `feedbackBaseURL` in `help.go`. It points at GitHub Issues
      meanwhile so the item is not a dead link, but that is a stand-in and not
      the destination — it demands an account and reads as developer territory,
      which is the opposite of what this item is for. `docsURL` is the same
      shape of placeholder, waiting on the site.
- [x] **Ship the licence texts inside the bundle.** Shipped 2026-08-24. Having
      `LICENSE`, `NOTICE` and `licenses/citeproc-js.LICENSE` in the repository
      satisfies source distribution and not binary distribution — Apache-2.0
      §4(d) requires `NOTICE` to travel with the work, and citeproc-js is dual
      CPAL/AGPL, both of which require their licence to accompany what is
      distributed. `bundle:licences` copies four texts (the CSL styles' licence
      is the fourth) into `Contents/Resources/licences` with `.txt` extensions,
      so double-clicking one opens it rather than prompting for an application.
      Two things it is worth knowing the reasons for. The task lives in the
      **root** `Taskfile.yml`, not `build/darwin/Taskfile.yml`, because that
      file is regenerated by `update:build-assets` and the root one is not. And
      it **re-signs afterwards**, because `codesign` seals `Contents/Resources`
      and anything added later invalidates the signature — which matters more
      once this is a Developer ID rather than an ad-hoc one.
      The other half of the question resolved differently than expected: not an
      About → Licences view but a Help → Licences item, which opens the folder
      through `app.Browser.OpenFile` — never a hand-built `file://` URL, since
      the bundle name contains a space. `licencesPath` is split out of the menu
      closure to be testable, the same reason `feedbackURL` and `osDescription`
      are. Unbundled — `go run`, or the bare binary — there is nothing to open,
      so it falls back to the repository rather than doing nothing.
- [x] **A new application icon, layered.** Shipped 2026-08-23. The winged nib
      is replaced by an H printed as three out-of-register process plates on
      screened paper; the SVG source set lives in `build/icon/`, and
      `build/appicon.icon/` holds the Icon Composer bundle actool compiles into
      `build/darwin/Assets.car`.
      It shipped in two steps, which is worth knowing because the first is a
      complete fallback if the second ever breaks: the artwork went in flat
      first, rendered to `build/appicon.png` and through the ordinary
      `icons.icns` path, and layering was added afterwards once Xcode 26 was
      installed. Layering is purely additive.
      Two things this entry previously recorded as blockers turned out not to
      be. Installing Xcode is necessary but not sufficient — `/usr/bin/actool`
      is a shim that fails until `xcode-select` points at Xcode rather than
      Command Line Tools. And the blend-mode problem dissolved rather than
      being solved: the concern was that the design switches
      `mix-blend-mode` between `multiply` on paper and `screen` on dark, which
      Icon Composer cannot express because it overrides a layer's *fill* rather
      than its blend mode. In practice actool generates the light, dark and
      tintable appearances from the layers itself — confirmed with
      `assetutil --info` — so the dark-ground SVG is reference artwork rather
      than an input, and the mismatch never had to be resolved.
      One trap it cost an afternoon to find, recorded in CLAUDE.md: `Info.plist`
      must declare `CFBundleIconName` only while `Assets.car` exists. macOS 26
      prefers that key over `CFBundleIconFile`, so a dangling value leaves the
      app with **no icon at all** while everything else about the bundle is
      valid — icns present, signature good, LaunchServices resolving it by
      name. Regeneration adds the key when the catalogue is present but never
      removes it, so dropping the catalogue means deleting the key by hand.

## v0.10.0 — Authoring and output

Three features drawn from a survey of similar products (2026-08-08), kept
because they serve paper-writing specifically rather than because other
editors have them. What was deliberately *not* taken: seamless in-place
WYSIWYG editing, which would replace the split view, scroll sync and the
chart placeholders at once and fights a domain where a Vega-Lite spec and a
citation key have no meaningful inline visual form; and a file-tree sidebar,
which is the multi-part document idea dropped on 2026-08-06.

- [ ] Export to DOCX and LaTeX through Pandoc. Hermes already builds toward
      Pandoc without collecting the payoff: `![caption](img)` was chosen
      because it is exactly Pandoc's figure convention, citations are `[@key]`,
      and the figures design argues captions live in each format's native home
      so a Pandoc conversion keeps them. Meanwhile the only output is PDF
      through the print panel, and co-authors and journals want `.docx`. The
      decision to settle first is the dependency: shell out to a Pandoc the
      user installed (simple, but fails on a fresh machine and needs a
      not-found path that explains itself), or bundle one (a much larger
      binary, though v1.0 is already facing signing and notarization, so the
      packaging conversation is open anyway). Bibliography handling needs
      thought too — Pandoc can resolve citations itself from the same `.bib`,
      which may mean handing it the raw markdown rather than anything Hermes
      has already rendered.
- [ ] An outline panel: the document's heading structure, with click-to-jump.
      Cheaper than it looks, because the data already exists. `renderer.ts`'s
      `source_line` core rule stamps every top-level block — headings
      included — with its document line, so an outline is a second consumer of
      the token pass `figures.ts` already walks, and jumping to an entry is
      `scrollSync.ts`'s existing line-to-offset mapping run in reverse. The
      open questions are where it lives (a third pane, or an overlay), whether
      it is driven from the editor's syntax tree or the renderer's tokens, and
      whether it scrolls the editor, the preview, or both.
- [ ] A table builder. Markdown tables are the worst hand-editing experience
      left in Hermes, and this is the same shape of problem the chart builder
      already solved — with most of the parts already built. `lib/dataTable.ts`
      parses delimited text into typed columns and rows, and `toDelimited`
      (v0.6) renders a table back to text, so a builder is largely those two
      plus a grid and a pipe-table serializer. Two things the chart builder
      does not have to worry about: a markdown table is *editable as text* in
      the document, so reopening one means parsing pipe-table syntax rather
      than JSON, and alignment markers (`:---`, `---:`) have no equivalent in
      `DataTable` and would need somewhere to live.
- [ ] A real New Document flow, rather than a template dropped into an
      untitled buffer. Reported from real use on 2026-08-19. Today File → New
      seeds `NEW_DOCUMENT_TEMPLATE` with the `bibliography` and `csl` keys
      commented out, and the document stays unsaved and unnamed until the
      first ⌘S — so a citation cannot resolve until the author has saved,
      named a `.bib`, and created that file by hand elsewhere. The proposal:
      ask for the filename up front, ask whether the document has a
      bibliography, and if it does, create the `.bib` beside it and write a
      live `bibliography:` key instead of a commented-out one. That removes
      the step where the author has to know a `.bib` is resolved relative to
      the document. Points to settle: whether this replaces File → New or
      sits beside it (the current zero-friction path is worth keeping for a
      scratch document); whether an empty `.bib` should be created or one
      seeded with a comment, given `parseBib` warns on entries it cannot
      parse; what happens when the file already exists; and whether the
      dialog also takes the citation style, since `csl` is the other key and
      the five bundled styles are otherwise discoverable only from the
      template's comments. Related: `unsavedBibliographyMessage` exists
      precisely because an unsaved document cannot load a bibliography — a
      good flow here would make that message rare rather than routine.
- [ ] A clickable table of contents in the exported PDF. The same heading
      data the outline panel above needs, with a different consumer, so the
      two should be designed together rather than twice. Two distinct pieces:
      a rendered contents list at the top of the document (straightforward —
      the headings are already stamped with `data-source-line`), and *internal
      links that work in the PDF*, which is the part that needs proving. That
      depends on anchor `id`s on the headings and on WebKit's print path
      preserving intra-document links as PDF link annotations; whether it does
      is an open question that should be answered with a spike before this is
      scoped, since if it does not, the honest answer is that a clickable
      index needs a real PDF writer and belongs with the Pandoc work above.
      Also to settle: whether the contents list is opt-in per document (a
      frontmatter key — which would be the third key Hermes reads, after
      `bibliography` and `csl`) or a document-wide setting like figure
      alignment.
- [ ] Spell checking. Nothing exists today and there is nothing to switch on,
      for two independent reasons. `@codemirror/view` hardcodes the content
      element's attributes as `spellcheck: "false"` (alongside `autocorrect`
      and `autocapitalize` off) and `Editor.svelte` never overrides them, so
      the editor's contenteditable tells WebKit not to check; and Wails'
      `EditMenu` role builds Undo/Redo, Cut/Copy/Paste, Paste and Match Style,
      Delete, Select All and Speech, with no Spelling and Grammar submenu — so
      even with squiggles there would be no way to toggle continuous checking
      or reach the spelling panel. The preview pane cannot help: WebKit only
      checks editable regions and it is not one.
      There is a genuine quick win to try first —
      `EditorView.contentAttributes.of({ spellcheck: 'true' })` gives native
      macOS squiggles and right-click corrections immediately — but it is
      probably worse than nothing on its own, because CodeMirror does not know
      what the text means: it would flag every citation key (`@alqedra2026`),
      every LaTeX command inside `$…$`, every Vega-Lite field name, every
      Mermaid node id, and the whole contents of every code fence. A paper is
      heavy on all four. So try it, look at a real document, and expect to
      need the prose-only version.
      Doing it properly means checking prose and nothing else, which Hermes is
      better placed for than most: `lib/markdownCommands.ts` already has
      `isProtected` for the same "never touch fenced code or frontmatter"
      question, and the syntax tree behind it knows where the code, maths and
      citations are. The open questions are whether the native checker can be
      scoped to regions at all (it works on the contenteditable as a whole, so
      the answer may be no, and a JS dictionary becomes the alternative —
      which is a much larger feature and a bundled dictionary per language),
      whether a Spelling and Grammar submenu has to be built by hand in
      `menu.go` since the role does not provide one, and whether the choice
      persists in `Settings` like sync scrolling does.

## v1.0.0 — Production

Distribution is step 1 of the website work: GitHub Releases for the binary and
a static documentation site, with no server to run and no ongoing cost beyond
the Apple Developer Program. Hosting users' documents as blog posts is a
separate, much larger project and is deliberately not part of this.

- [ ] **A release workflow.** CI arrived on 2026-08-23 — `ci.yml` runs the
      frontend suite and audit on Linux and the Go suite, build and
      govulncheck on macOS, and `codeql.yml` alongside it — but nothing
      releases. Do the first release by hand so the steps are understood, then
      move `wails3 task release` into a tag-triggered workflow. That needs the
      Developer ID certificate and an App Store Connect API key as repository
      secrets, which is the part worth getting right rather than fast: a
      leaked signing identity is not revocable in any comfortable way. The
      API key matters more than convenience here — unlike an app-specific
      password it is not tied to a personal Apple ID, and it can be revoked
      on its own.
- [ ] **A documentation site**, static, on GitHub Pages. Most of the content
      exists — `README.md`, `docs/hermes-authoring.md`, `CHANGELOG.md` — so
      the work is a generator (Astro Starlight, MkDocs Material or similar), a
      landing page with a download link, and pointing the release at it.
      Sequencing note: the bundled in-app guides land in v0.9, and the
      eventual ambition is that the site's pages ARE Hermes documents
      published through the app. That argues for keeping the first site
      deliberately thin rather than investing in a structure the publishing
      work would then replace.
- [ ] **Auto-update — deliberately deferred, and worth naming.** Without
      something like Sparkle, everyone who downloads a release stays on it
      until they think to check. Tolerable at first; the main complaint later.
      One constraint to note now: Sparkle validates that an update is signed by
      the same team, so if the Developer ID ever changes — an individual
      enrolment becoming an organization one, say — that needs a transitional
      release. Cheapest while there are few users.
- [ ] Windows and Linux stay in the backlog.

## Backlog (unscheduled)

Ideas noted along the way, not yet committed to a release:

- Revisit Vite 8 once the upstream Rolldown lone-surrogate bug is fixed
  (v0.1 pinned Vite 7 to keep KaTeX's lexer intact).
- File a Wails issue for the hardcoded landscape print orientation (their
  code carries a TODO inviting a config option; Hermes ships its own print
  path meanwhile).
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

Real findings from the v0.4, v0.5 and v0.8 code reviews and from manual
testing, judged not to block those releases. Recorded so they are not
rediscovered from scratch; struck as they are fixed.

What is left is not a queue. Both entries are decisions — one an accepted
limitation, one a test deliberately not written — kept here because the
reasoning is the useful part and would otherwise have to be worked out again
by whoever next notices the behaviour:

- Scroll-sync anchor density is sparser inside blockquotes and list items: the
  markdown-it core rule stamps `data-source-line` on top-level blocks only, so
  a long list is one anchor rather than several. Interpolation keeps this
  near-exact for uniform content; it degrades only when a list item contains a
  chart or a large image.
- `Editor.topVisibleLine()` has no test, and the reviewer argued *against*
  adding the obvious one: under jsdom `posAtCoords` returns null so the
  function always yields 1, which is also what the happy path returns for
  offset 0 — a test asserting 1 would pass against an implementation that
  dropped the null check entirely. Testing it honestly needs a real layout
  engine.
