---
bibliography: zotero-export-text.bib
csl: apa
---

# Hermes Test Document

The one document to open after any substantial change. Work down it in the
preview; every section says what correct looks like, so a wrong result is
visible without knowing the implementation. The last section is *supposed* to
look broken.

Swap `csl:` in the frontmatter to `ieee`, `vancouver`, `chicago-author-date`
or `harvard` to re-render every citation and the bibliography in that style.

**About the bibliography.** `zotero-export-text.bib` is auto-synced from
Zotero — do not hand-edit it, and do not add fixture entries to it. Section 10
names specific works, so if the library changes, those expectations need
updating rather than the file. What that costs us is written down at the end
of section 10.

## 1. Text basics

This paragraph has **bold text**, *italic text*, ***bold italic***, `inline
code`, ~~strikethrough~~, and a [link to the Wails docs](https://v3.wails.io) —
clicking it must open your browser, not navigate the app away.

A second paragraph, to check spacing. There should be a clear gap above this
line, and the line height should feel comfortable for long-form reading.

> A blockquote: "The purpose of computing is insight, not numbers." Indented,
> with a left border and slightly muted text.

---

That was a horizontal rule.

## 2. Lists

1. First ordered item
2. Second ordered item
   1. Nested ordered child
   2. Another nested child
3. Third ordered item

- Unordered item with a sub-list:
  - Nested bullet one
  - Nested bullet two
- Unordered item with `code` and **bold** inside

## 3. Table

| Quantity | Symbol | Unit |
|----------|:------:|------|
| Energy | $E$ | joule |
| Entropy | $S$ | J/K |
| Density matrix | $\rho_\mathcal{S}$ | — |

Cells should have borders and padding; the two maths cells must render as
KaTeX, and the middle column stays centred.

## 4. Code block

```python
def entropy(p):
    """Shannon entropy."""
    return -sum(x * math.log2(x) for x in p if x > 0)
```

The **editor** and the **preview** should colour this block identically —
`def`, `return`, `for` and `if` as keywords, the docstring as a string, `0`
as a number — and the two must still agree after switching View → Appearance
between Light and Dark.

```notalang
this fence names a language nobody has heard of
```

`notalang` is not a real language. The block above should render as plain,
uncoloured text in both panes rather than erroring.

## 5. Inline maths

Euler's identity $e^{i\pi} + 1 = 0$ sits inside a sentence. The mass–energy
relation $E = mc^2$, a subscripted state $\rho_\mathcal{S}$ (regression check:
multi-letter commands), a fraction $\tfrac{a+b}{c}$, and Greek letters
$\alpha, \beta, \gamma$ should all sit on the surrounding baseline. Plain
dollar amounts like $5 and $10 must **not** become maths.

## 6. Display maths

The Gaussian integral:

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

A matrix and a summation, centred on their own lines:

$$A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}, \qquad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$$

Aligned equations:

$$\begin{aligned} \nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\ \nabla \cdot \mathbf{B} &= 0 \end{aligned}$$

## 7. Charts

A bar chart:

```vega-lite
{
  "description": "Simple bar chart",
  "data": {
    "values": [
      {"category": "A", "value": 28}, {"category": "B", "value": 55},
      {"category": "C", "value": 43}, {"category": "D", "value": 91},
      {"category": "E", "value": 81}, {"category": "F", "value": 53}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal", "axis": {"labelAngle": 0}},
    "y": {"field": "value", "type": "quantitative"}
  }
}
```

A line chart with points:

```vega-lite
{
  "description": "Line chart with points",
  "data": {
    "values": [
      {"x": 0, "y": 1.0}, {"x": 1, "y": 1.6}, {"x": 2, "y": 2.6},
      {"x": 3, "y": 4.1}, {"x": 4, "y": 6.6}, {"x": 5, "y": 10.5}
    ]
  },
  "mark": {"type": "line", "point": true},
  "encoding": {
    "x": {"field": "x", "type": "quantitative"},
    "y": {"field": "y", "type": "quantitative"}
  }
}
```

The same bar chart again — a duplicated spec must render **both** copies, the
second not stealing the first:

```vega-lite
{
  "description": "Simple bar chart",
  "data": {
    "values": [
      {"category": "A", "value": 28}, {"category": "B", "value": 55},
      {"category": "C", "value": 43}, {"category": "D", "value": 91},
      {"category": "E", "value": 81}, {"category": "F", "value": 53}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal", "axis": {"labelAngle": 0}},
    "y": {"field": "value", "type": "quantitative"}
  }
}
```

Now type somewhere else in the file. The charts must **not** flicker while you
type — they are cached by spec text and should be moved, not re-embedded.

## 8. Figures

A captioned chart becomes a numbered figure, its caption drawn once below it
and *not* a second time inside the SVG:

```vega-lite
{
  "title": "Recovered sources",
  "data": {
    "values": [
      {"category": "A", "value": 12}, {"category": "B", "value": 27},
      {"category": "C", "value": 19}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal"},
    "y": {"field": "value", "type": "quantitative"}
  }
}
```

A captioned image continues the same sequence — "Figure 2", not "Figure 1"
again:

![A placeholder photograph](https://placehold.co/400x250)

An empty alt image stays decorative: no number, no caption, no `<figure>`
wrapper:

![](https://placehold.co/120x80)

This chart sets its own `"width"`, which must win over View → Chart Width —
changing that setting resizes every other chart on this page but not this one:

```vega-lite
{
  "width": 150,
  "data": {"values": [{"x": 0, "y": 1}, {"x": 1, "y": 2}, {"x": 2, "y": 4}]},
  "mark": "point",
  "encoding": {
    "x": {"field": "x", "type": "quantitative"},
    "y": {"field": "y", "type": "quantitative"}
  }
}
```

Cycle View → Figure Alignment through Left, Centre and Right: both figures
above and the decorative image must move together, captions included.

Then narrow the preview pane until a chart would overflow it. The chart scales
down; the pane must never scroll sideways.

Known cosmetic issue, not a regression: in dark mode `.vega-lite-chart` is a
full-width block with a light card behind it, so alignment moves the chart
*within* the card rather than moving the card. Right alignment looks like a
chart pushed to the right edge of a white panel.

## 9. Chart builder

Insert → Chart… (or the toolbar Chart button):

- Paste a table, or use **Choose file…** with `docs/sample-data.csv`. The
  column dropdowns fill from the header row.
- Pick a mark, an x and a y; the preview updates as you go. Insert writes a
  `vega-lite` block at the cursor with the data inlined.
- Put the cursor back inside that block and reopen it. Every control is
  prefilled **including the data box**, which holds the chart's own table.
  Correct a value or add a row and commit — the change reaches the document.
- Give it a caption. The builder preview shows the caption *below* the chart,
  never inside it, and no figure number (numbering belongs to the document).
- With a large table pasted, the Insert/Update button stays visible while the
  body scrolls.
- Press Esc: the dialog closes without committing. Press Tab repeatedly: focus
  stays inside the dialog.
- With the builder open, try ⌘B or ⌘N. Both must be refused — the document
  behind the modal must not change.

Reopening the *first* chart in section 7 will refuse with an explanation: it
uses an `axis` property the builder cannot express. That is correct behaviour,
not a failure.

## 10. Citations

A simple citation [@zurekQuantumTheoryClassical2018], a multi-cite
[@everettRelativeStateFormulation1957; @zurekQuantumTheoryClassical2018], and a
narrative one: @korbiczRoadsObjectivityQuantum2021 sets out the argument.

Suppressed author, because the year is already in the sentence — Everett's 1957
paper [-@everettRelativeStateFormulation1957] — and a locator attached to a key
[see @kloeffelProspectsSpinBasedQuantum2013, pp. 51-53]. A section locator
works the same way [@hanceWhatDoesIt2022, sec. 2].

A group split by a hard line wrap must format like any other, with no raw
brackets and no `data-cite-index` left behind: [see
@leStrongQuantumDarwinism2019, pp. 3-4].

Several works supporting one claim [@horodeckiQuantumOriginsObjectivity2015;
@undenRevealingEmergenceClassicality2019; @korbiczRoadsObjectivityQuantum2021],
and a citation carried into a quotation intact:

> Objectivity is emergent [@leStrongQuantumDarwinism2019].

An unknown key must render as a visible inline error without blanking the rest
of the preview: [@notakey1999]. A group mixing a good key with a bad one is
reported the same way [@zurekQuantumTheoryClassical2018; @alsomissing1999].

### What to check

- Nothing anywhere in sections 1–9 shows raw `[@key]` text.
- **Many authors collapse.** `feinQuantumSuperpositionMolecules2019` and
  `urbaszekNuclearSpinPhysics2013` each have eight authors; in APA both render
  as *Fein et al.* and *Urbaszek et al.* Cite one here to see it:
  [@feinQuantumSuperpositionMolecules2019].
- **A missing year renders, it does not crash.** `fineBohrsResponseEPR` has no
  `year` field at all, so APA should read *(Fine, n.d.)*: [@fineBohrsResponseEPR].
- **A work with no author falls back to its title.** The one `@book` in the
  library, `DecoherenceQuantumToClassicalTransition2007`, has no `author`
  field: [@DecoherenceQuantumToClassicalTransition2007].
- **Brace protection is stripped, not printed.** Titles in this export carry
  BibTeX capital-protection like `{{Quantum Darwinism}}`, and surnames like
  `{Olaya-Castro}` are braced to keep them whole. The References list must show
  *Quantum Darwinism* and *Olaya-Castro* — never the braces.
- **A preprint renders as one.** `mullerSixMeasurementProblems2023` is a
  `@misc` with an arXiv eprint: [@mullerSixMeasurementProblems2023].
- References appears at the end, alphabetical, with one entry per work cited
  above and none for works merely present in the `.bib`.
- ⌘E exports with References intact and no entry split across a page break.
- Save the `.bib` from Zotero (or touch it) while this file is open: the
  preview refreshes on its own, via the bibliography watcher.

**One gap, deliberately not papered over.** Author-year disambiguation — the
`2021a` / `2021b` suffixes — cannot be exercised here, because no two works in
this library share a first author *and* a year. The old fixture bibliography
had a hand-made pair for it. Since the export is Zotero's and must not be
edited, that path now has unit coverage only. If a same-author-same-year pair
ever appears in the library, cite both here and the case comes back for free.

## 11. Things that must NOT become citations

None of the following may turn into a citation or reach the References list:

- An email address: write to a.zurek@example.org for the dataset.
- Plain brackets used as brackets: [see the appendix] and [2].
- A markdown link: [the project page](https://example.org/project).
- A citation inside a code span: `[@zurekQuantumTheoryClassical2018]` stays
  literal.
- A fenced code block:

```text
[@everettRelativeStateFormulation1957] must not be formatted here either.
```

## 12. Formatting commands

Put the cursor on this line and press ⌘2 — it becomes a Heading 2. Press ⌘2
again and it reverts. Press ⌘3 while it is a Heading 2 and the marker is
replaced, never stacked (`## ###` is a bug).

Select these three lines
and press ⌘⇧8 to bullet them,
then ⌘⇧7 to renumber them 1, 2, 3.

Select a word and press ⌘B, then ⌘B again to remove it. With the word still
bold, press ⌘I — it must become bold *and* italic, not lose the bold. ⌘Z once
must undo the whole action, not one marker at a time.

Select a word and press ⌘⇧K — it must become `` `code` ``, and must **not**
delete the line. CodeMirror binds ⌘⇧K to `deleteLine`; the editor re-binds it.

With a cursor but no selection, ⌘B inserts an empty `****` and leaves the
cursor between the markers. That is intended. ⌘I does the same with `**`.

These must refuse to change:

- Any line of the frontmatter at the top of this file.
- Any line inside a `vega-lite` block in section 7.
- The contents of an inline code span.

While the welcome pane is showing (relaunch and do *not* press ⌘N), ⌘B must do
nothing at all — no markers in the hidden document.

## 13. Editor and window behaviour

- **Folding.** ⌘⌥[ folds the block at the cursor, ⌘⌥] unfolds it. View → Fold
  All Code Blocks collapses every fence to its opening line and leaves
  headings and tables alone. A folded block's placeholder must be readable in
  dark mode.
- **Find.** ⌘F opens CodeMirror's panel. Its fields keep CodeMirror's own
  styling rather than the app's — that is deliberate; only the buttons' hover
  border picks up the app colour.
- **Undo after New.** Type something, File → New, then ⌘Z. The previous
  document must **not** come back. It used to, while the app already thought
  the document was new, so the next ⌘S wrote the old text into a new file.
- **Quit with unsaved changes.** Edit the document and press ⌘Q. You must get
  the unsaved-changes dialog, with **Save** focused — not Don't Save. The red
  close button and ⌘W behave the same way.
- **Cite in full screen.** Enter full screen and click Cite. macOS switches to
  Zotero's Space to show the picker, which is unavoidable; when the picker
  closes, Hermes must come back — pick a citation once and cancel once, both
  should return you.
- **Scroll sync.** Turn on View → Sync Scrolling and scroll past the tall
  charts in sections 7 and 8. The preview should track without jumping.

## 14. Chrome, dialogs and themes

- Every button — toolbar, both dialogs, the welcome pane — has padding, a
  border and a hover state. The recents list stays a column of file paths, not
  a stack of boxes.
- Tab through the toolbar and the pane divider: every stop shows a focus ring,
  the divider included.
- Both dialogs open **centred**, not pinned to a corner, and the backdrop dims
  the app behind them.
- Switch View → Appearance through System, Light and Dark. Chrome, preview and
  editor all follow, with no white flash on launch in dark mode.
- ⌘E: the exported PDF is always light, whatever the screen theme, with the
  toolbar and editor pane absent and figures unsplit across page breaks.

## 15. Intentional errors — these SHOULD look broken

Invalid LaTeX renders inline in red without blanking the preview:
$\thisisnotacommand{x}$

Broken Vega-Lite JSON renders an error card in place, and everything after it
still renders:

```vega-lite
{ "mark": "bar", this is not valid JSON
```

If you can read this line with normal styling, error containment works. ✅
