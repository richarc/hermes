---
bibliography: visual-test.bib
csl: apa
---

# Hermes Visual Test Document

Open this file in Hermes after any major change and scan each section in the
preview. Every element below should render correctly; the final section is
*supposed* to show errors.

## 1. Text basics

This paragraph has **bold text**, *italic text*, ***bold italic***, `inline code`,
~~strikethrough~~, and a [link to the Wails docs](https://v3.wails.io) — clicking
it must open your browser, not navigate the app.

A second paragraph to check spacing. There should be a clear gap above this line,
and the line height should feel comfortable for long-form reading.

> A blockquote: "The purpose of computing is insight, not numbers." It should be
> indented with a left border and slightly muted text.

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

Cells should have borders and padding; the two math cells must render as KaTeX.

## 4. Code block

```python
def entropy(p):
    """Shannon entropy — syntax colours are not expected, just a monospace block."""
    return -sum(x * math.log2(x) for x in p if x > 0)
```

## 5. Inline LaTeX

Euler's identity $e^{i\pi} + 1 = 0$ sits inside a sentence. The mass–energy
relation $E = mc^2$, a subscripted state $\rho_\mathcal{S}$ (regression check:
multi-letter commands), a fraction $\tfrac{a+b}{c}$, and Greek letters
$\alpha, \beta, \gamma$ should all align with the surrounding text. Plain dollar
amounts like $5 and $10 must **not** become math.

## 6. Display LaTeX

The Gaussian integral:

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

A matrix and a summation, centered on their own lines:

$$A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}, \qquad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$$

Aligned equations:

$$\begin{aligned} \nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\ \nabla \cdot \mathbf{B} &= 0 \end{aligned}$$

## 7. Vega-Lite charts

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

The same bar chart again — a duplicate spec must render **both** copies
(regression check: the second must not steal the first):

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

While this document is open, type some text elsewhere in the file: the charts
must **not** flicker while you type (cache check).

## 9. Citations

A simple citation [@smith2020], a multi-cite [@smith2020; @doe2021], a
narrative citation: @doe2021 argues the point. Suppressed author [-@smith2020],
with locator [see @doe2021, pp. 33-35], and disambiguation [@smith2020; @smith2020x].
An unknown key must show an inline error: [@notakey1999].

A group split by a hard line wrap must format like any other, showing no raw
brackets and no `data-cite-index` attribute: [see @smith2020,
pp. 12-14].

A References section should appear at the end of this document, before nothing —
check it lists Smith (2020a, 2020b) and Doe (2021), and that ⌘E includes it in
the PDF without splitting entries across pages.

## 10. Formatting commands

Put the cursor on this line and press ⌘2 — it becomes a Heading 2. Press ⌘2
again and it reverts. Press ⌘3 on it while it is a Heading 2 and the marker is
replaced, never stacked (`## ###` is a bug).

Select these three lines
and press ⌘⇧8 to bullet them,
then ⌘⇧7 to renumber them 1, 2, 3.

Select a word in this sentence and press ⌘B, then ⌘B again to remove it. With
the word still bold, press ⌘I — it must become bold *and* italic, not lose its
bold. ⌘Z once must undo the whole action, not one marker at a time.

These must refuse to change:

- Any line of the frontmatter at the top of this file.
- Any line inside the vega-lite block in section 7.
- The contents of an inline code span like `[@smith2020]`.

Select a word and press ⌘⇧K — it must become `` `code` ``. It must NOT delete
the line: CodeMirror binds ⌘⇧K to deleteLine, and the editor re-binds it.

With a cursor but no selection, ⌘B inserts an empty `****` pair and leaves the
cursor between the markers — that is intended, not a bug. ⌘I does the same with
`**`. Type inside the pair and the text picks up the format.

While the welcome pane is showing (relaunch the app and do *not* press ⌘N, which
dismisses it), ⌘B must do nothing at all — no markers in the hidden document.

## 11. Intentional errors — these SHOULD look broken

Invalid LaTeX renders inline in red, without blanking the preview:
$\thisisnotacommand{x}$

Broken Vega-Lite JSON renders an error card in place, and everything after it
still renders:

```vega-lite
{ "mark": "bar", this is not valid JSON
```

If you can read this line with normal styling, error containment works. ✅
