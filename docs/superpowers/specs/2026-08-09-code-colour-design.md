# Hermes — Colour for Code: Design

**Date:** 2026-08-09
**Status:** Approved design, pending implementation plan
**Release:** v0.7.0 (syntax highlighting) and v0.8.0 (document-source colours)

## Overview

Fenced code has no colour in Hermes. Not in the preview, and — contrary to
what the roadmap says — not in the editor either. This gives it colour in both,
from one table, so the same code looks the same wherever it appears.

The two roadmap bullets are done together deliberately. v0.7 asks for preview
highlighting, v0.8 for a document-source colour scheme, and the roadmap already
notes the two must agree. Done apart, the palette gets chosen twice; done
together, the panes agree by construction because one mapping drives both.

## What is actually there today

Established by reading and by running the code, not by assumption — the first
two readings of this were both wrong.

**The editor parses code but does not colour it.** `markdown({ codeLanguages:
languages })` loads the grammar and tags the tokens correctly. `hermesHighlight`
then defines six markdown tags and nothing else. The tokens render in plain
foreground text.

The reason is worth recording, because it is not obvious and it misled two
attempts at this analysis. `basicSetup` registers CodeMirror's
`defaultHighlightStyle` with `{ fallback: true }`, and it is tempting to assume
unmapped tags fall through to it. They do not: `getHighlighters` returns
`main.length ? main : fallback`, so registering *any* non-fallback highlighter
displaces the default entirely. Verified empirically — with `basicSetup` alone
a Python `def` renders as `<span class="ͼb">def</span>`; adding a
`HighlightStyle` that maps only `heading` removes the span altogether.

Two consequences. There is **no** pre-existing contrast problem, because there
are no colours to fail one. And unmapped tags stay plain rather than reverting
to CodeMirror's defaults, so this work is purely additive and can start small
without leaving anything broken behind it.

**The preview emits no token markup at all.** For a Python fence, `render()`
produces:

```html
<pre><code data-source-line="1" class="language-python">def f(x):
    return &quot;hi&quot;  # note
</code></pre>
```

One flat text node. markdown-it records the language as a class, which is a
hook nothing currently uses.

## Decisions

| Question | Decision |
|---|---|
| Colour by language or by token? | By token — one mapping, every language |
| How many colours? | Five new, plus `--syn-meta` reused for comments |
| Where does preview highlighting run? | A hydration pass, not during `render()` |
| Which grammars? | The editor's own, via `@codemirror/language-data` |
| New dependencies? | None at runtime; `@lezer/highlight` gets *declared* |
| Markdown's existing colours | Untouched |

**Colour is per token type, never per language.** Every Lezer grammar tags
from one shared vocabulary, so `def` in Python and `func` in Go both carry
`tags.keyword`. One table covers all ~150 languages `language-data` knows, and
adding a language later needs no colour work.

**The editor's own grammars are reused rather than a highlighter added.**
`@lezer/highlight`'s `highlightCode` runs a Lezer parser over a string and
emits tokens with classes; `language-data` loads those parsers standalone.
Verified end to end before choosing it. This is what makes the two panes agree
*by construction* — the alternative, a second highlighter such as Shiki or
highlight.js, would bring a different grammar set that could only ever be
matched to the editor by hand, and would add a dependency to do it.

## The mapping

| Palette name | Tags |
|---|---|
| `--syn-keyword` | `keyword`, `controlKeyword`, `moduleKeyword`, `operatorKeyword`, `definitionKeyword`, `self`, `null`, `bool`, `atom` |
| `--syn-string` | `string`, `special(string)`, `regexp`, `character` |
| `--syn-number` | `number`, `integer`, `float`, `literal` |
| `--syn-type` | `typeName`, `className`, `namespace` |
| `--syn-function` | `function(variableName)`, `function(propertyName)`, `definition(variableName)` |
| `--syn-meta` *(existing)* | `comment`, `lineComment`, `blockComment`, `docComment` |

Every name above was checked against `@lezer/highlight`'s exports; a
misremembered tag is a build break, not a wrong colour.

Comments reuse `--syn-meta` rather than taking a sixth new name: a comment is
metadata, and the markdown tag already sharing that colour is `meta`.

## Tokens

Five new names, in all three palette blocks:

| Name | Light | Dark | Print |
|---|---|---|---|
| `--syn-keyword` | `#7b2d8e` | `#d6a3e8` | `#7b2d8e` |
| `--syn-string` | `#1a6b3a` | `#8fd19e` | `#1a6b3a` |
| `--syn-number` | `#9a4a00` | `#e0a878` | `#9a4a00` |
| `--syn-type` | `#0d6b6b` | `#7fd0d0` | `#0d6b6b` |
| `--syn-function` | `#1a4fa0` | `#8fb8f0` | `#1a4fa0` |

Contrast against the editor backgrounds, computed before the colours were
proposed rather than after: the lowest is `--syn-string` at 6.38:1 light, and
every value clears the project's 4.5:1 bar in both themes with margin. Five
pairs join `contrast.test.ts`, which checks the light and dark blocks.

Print takes the light values. Exported PDFs are always light, the values are
already dark enough for paper, and `contrast.test.ts` does not check print —
so a separate set would be three more numbers nobody verifies.

## The preview: a hydration pass

markdown-it's `highlight` option is synchronous. `LanguageDescription.load()`
is not. Highlighting therefore cannot happen inside `render()`, which is also
the wrong place for it — `render()` runs on every debounced keystroke and must
stay cheap.

It becomes a second hydrator in `Preview.svelte`, alongside the chart one and
following the same shape:

- find `pre > code[class*="language-"]` that is not already highlighted;
- resolve the language name against `language-data`, by name or alias;
- `await` the grammar, parse, and walk the tree with `highlightCode`;
- generation-guard the pass, so a newer render abandons an older one;
- cache the result, keyed on language plus source text — the only two things
  the output depends on.

The cache matters for the same reason the chart cache does: `Preview.svelte`
assigns `container.innerHTML = html` on every render, wiping the spans, so
without one a large document would re-parse every block on every keystroke.

Two differences from the chart hydrator, both worth stating so the symmetry is
not over-applied:

- **No `sync.invalidate()` afterwards.** Spans do not change block heights, so
  scroll-sync anchors stay valid. The chart hydrator invalidates because charts
  do change height.
- **DOM nodes, not an HTML string.** `highlightCode`'s callbacks hand back raw
  text and a class name. Building `document.createTextNode` and `span` elements
  from them sidesteps escaping altogether, rather than getting escaping right
  by hand on document content.

`data-source-line` sits on the `<code>` element, and only its children are
replaced, so the scroll-sync anchor survives untouched.

## The editor

The same table, added to `hermesHighlight` in `Editor.svelte`. Nothing else
changes: the grammars are already loaded, the tokens already tagged.

Because one table drives both panes, they cannot drift. That is the whole
argument for doing the two roadmap bullets together.

## Bundle cost

None up front. `language-data` dynamically imports each grammar on first use,
so a paper with one Python block loads one grammar and a paper with none loads
nothing — the same discipline `charts.ts` applies to `vega-embed`, and for the
same reason.

## Error handling

| Situation | Result |
|---|---|
| Unknown language (` ```notalang `) | No match; block stays plain, as today |
| Grammar fails to load | Caught; block stays plain |
| No language on the fence | No `language-` class; skipped |
| `vega-lite` fence | Never reaches `<pre><code>`; unaffected |

Every failure degrades to exactly what ships today, which is the useful
property of building on an absence.

## Testing

- `styleContract.test.ts` covers the five new names the moment they are added:
  no literal colours in rules, and identical names across all three blocks.
- `contrast.test.ts` gains five pairs.
- The hydrator, under jsdom: a `<pre><code class="language-…">` goes in, spans
  with the expected classes come out; an unknown language is left alone; a
  second pass over identical content hits the cache rather than re-parsing.
- The tag table is worth a test of its own — that every tag it names resolves,
  so a renamed or misremembered tag fails loudly rather than silently losing a
  colour.

**A trap to avoid, learned the hard way.** If a test needs a concrete grammar,
declare that package as a devDependency rather than importing it transitively
through `language-data`. Importing `@codemirror/commands` transitively is
exactly what broke seven unrelated tests earlier in this project.

### What is not tested

Whether it looks right, and whether the colours read well on paper. jsdom
computes no layout and prints nothing.

## Manual check

1. Open `docs/test-document.md`. The Python block in section 4 is coloured, in
   the editor and the preview, and the two match.
2. Switch View → Appearance between Light and Dark. Both panes follow.
3. Type in the document. Code does not flicker as you type — the cache is
   doing its job.
4. Add a fence in a language not used elsewhere; it colours after a moment,
   the pause being the grammar loading once.
5. ` ```notalang ` stays plain rather than erroring.
6. Export a PDF: code is coloured, and legible on white.
7. Section 4's note that preview highlighting is "v0.7, not yet" is now stale —
   update it.
