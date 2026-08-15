# Hermes Editor

A desktop editor for writing academic papers in markdown, with LaTeX maths,
Vega-Lite charts, and Pandoc-style citations rendered live and exported to PDF.

Hermes keeps markdown as the source of truth. There is no hidden document
format: what you type is a plain `.md` file you can put in git, and everything
on screen is rendered from it.

- **Split view** — markdown source on the left, live preview on the right.
- **Maths** — LaTeX via KaTeX, inline and display.
- **Charts** — Vega-Lite specs in fenced code blocks become live charts.
- **Citations** — `[@key]` against a BibTeX file, formatted through CSL with
  five bundled styles and an automatic References section.
- **Zotero** — insert citations straight from your library via Better BibTeX.
- **PDF export** — the preview, including charts and references, printed to PDF.

Current release: **v0.3.0**. See [CHANGELOG.md](CHANGELOG.md) for what shipped
and [ROADMAP.md](ROADMAP.md) for what is planned.

---

## Requirements

Hermes is currently macOS-focused. The paths, menus, and print behaviour assume
macOS; Windows and Linux support is on the backlog.

| Requirement | Notes |
|---|---|
| macOS | Apple silicon or Intel |
| [Go](https://go.dev) 1.25 or newer | Backend |
| [Node.js](https://nodejs.org) 20 or newer | Frontend build |
| [Wails v3 CLI](https://v3.wails.io) | Alpha (`v3.0.0-alpha2.118`) |
| [Zotero](https://www.zotero.org) + Better BibTeX | Optional — only for citation picking |

Install the Wails v3 CLI:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
```

## Building and running

Clone the repository, then install the frontend dependencies once:

```bash
cd frontend && npm install && cd ..
```

Then pick one:

```bash
wails3 dev       # development mode, hot-reloads Go and frontend changes
wails3 build     # production binary into bin/
wails3 package   # packaged .app bundle
```

Wails v3 uses [Task](https://taskfile.dev) for orchestration, so `wails3 task
<name>` and `task <name>` are equivalent.

---

## Your first document

1. Launch Hermes. The startup pane lists recent files and offers **New
   document**. To open a file that is not listed, use **File → Open…** (⌘O).
2. Type markdown on the left. The preview updates as you type.
3. Save with ⌘S. Saving matters more than usual here — a bibliography is
   resolved relative to the document, so an unsaved document cannot load one.

### Maths

Inline maths goes between single dollars, display maths between double:

```markdown
The relation $E = mc^2$ sits inside a sentence.

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$
```

### Charts

A fenced code block tagged `vega-lite` containing a
[Vega-Lite](https://vega.github.io/vega-lite/) spec renders as a live chart:

````markdown
```vega-lite
{
  "data": {"values": [{"a": "A", "b": 28}, {"a": "B", "b": 55}]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "a", "type": "nominal"},
    "y": {"field": "b", "type": "quantitative"}
  }
}
```
````

---

## Citations and bibliography

### 1. Point the document at a `.bib` file

Add a YAML frontmatter block at the very top of the document:

```markdown
---
bibliography: refs.bib
csl: apa
---

# My Paper
```

- `bibliography` is resolved **relative to the document**, so `refs.bib` means
  "next to this file". An absolute path also works.
- `csl` selects the citation style. Omit it for APA.

Bundled styles: `apa` (default), `chicago-author-date`, `ieee`, `vancouver`,
`harvard`.

Do **not** write your own `## References` heading. Hermes appends the heading
and the formatted bibliography itself, so writing one produces two.

### 2. Cite

Hermes supports the practical Pandoc subset:

| You write | You get (APA) |
|---|---|
| `[@smith2020]` | (Smith, 2020) |
| `[@smith2020; @doe2021]` | (Smith, 2020; Doe, 2021) |
| `@smith2020` | Smith (2020) |
| `[-@smith2020]` | (2020) |
| `[see @smith2020, pp. 33-35]` | (see Smith, 2020, pp. 33–35) |
| `[@nosuchkey]` | `[@nosuchkey?]` in red |

Locators are recognised as `p.` / `pp.` / `page` / `pages`, `chap.` /
`chapter`, `sec.` / `section`, or a bare number. Anything else after the comma
is kept as plain text.

A citation group may wrap across a line break — useful when your prose is
hard-wrapped:

```markdown
The effect was first reported in the original study [see @smith2020,
pp. 20-22].
```

An unresolvable key renders visibly in place rather than blanking the preview,
so a typo never costs you the rest of the document.

### 3. Editing the `.bib`

Hermes watches the bibliography file. Edit and save it in any other editor and
the preview refreshes within about two seconds — no need to reopen the
document.

---

## Setting up Zotero

This is optional. Citations work fine against a hand-written `.bib`. Zotero
adds a picker so you can insert keys from your library without typing them.

**The one thing to understand before you start:** Zotero only supplies the
*key*. Hermes resolves that key against the `.bib` file named in your
frontmatter — it never queries Zotero. So the picker is only useful when your
`.bib` is an export of the same library. Getting this wrong is the most common
setup problem, and it looks like a red `[@key?]` right after you insert.

### Step 1 — Install Zotero and Better BibTeX

1. Install [Zotero](https://www.zotero.org/download/).
2. Install the [Better BibTeX](https://retorque.re/zotero-better-bibtex/)
   plugin: download the `.xpi` without unzipping it, then in Zotero open
   **Tools → Plugins** (**Tools → Add-ons** in Zotero 6), click the gear icon,
   choose **Install Plugin From File…**, and select the `.xpi`.
3. Restart Zotero.

Better BibTeX gives every item a stable citation key, shown in the item pane as
**Citation Key**. That key is what goes in your document.

### Step 2 — Export your library to a `.bib` that stays current

1. In Zotero, right-click the collection you want (or **My Library**).
2. Choose **Export Collection…**.
3. Set **Format** to **Better BibTeX**.
4. Tick **Keep updated**. This is the important one — it makes Zotero re-export
   automatically whenever you change an item.
5. Save the file next to your document, for example `refs.bib`.

### Step 3 — Point your document at it

```markdown
---
bibliography: refs.bib
csl: apa
---
```

Save the document into the same folder as `refs.bib`.

### Step 4 — Insert a citation

With Zotero running, put the cursor where the citation belongs and either:

- press **⌘⇧C**, or
- use **File → Insert Citation…**, or
- click the **Cite** button in the toolbar.

Zotero's picker opens. Search, select one or more items, press Enter, and the
keys are inserted at your cursor in Pandoc format. Because your `.bib` is an
export of that same library, they resolve immediately.

Edit an item in Zotero afterwards and the chain runs end to end on its own:
Better BibTeX re-exports, Hermes notices the file changed, and the preview
updates.

### Zotero troubleshooting

**"Zotero (with Better BibTeX) isn't running"** — Zotero is closed, or Better
BibTeX is not installed. Check the connection independently:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:23119/better-bibtex/cayw?probe=probe"
```

`200` means Zotero and Better BibTeX are reachable and the problem is
elsewhere. Anything else means Zotero's end needs fixing.

**The key inserts but shows red as `[@key?]`** — the key is not in the `.bib`
your document names. Either the `.bib` is not an export of that library, or the
auto-export has not run. Re-export with **Keep updated** ticked. Hermes tells
you which file it checked.

**"Save the document to load refs.bib"** — the document has never been saved,
so there is no folder to resolve `refs.bib` against. Save it first.

---

## Exporting to PDF

**File → Export PDF…** (⌘E) prints the rendered preview, including maths,
charts, and the References section. Page orientation is set under **File → PDF
Orientation** and is remembered between sessions.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘N | New document |
| ⌘O | Open… |
| ⌘S | Save |
| ⌘⇧S | Save As… |
| ⌘⇧C | Insert Citation… (Zotero picker) |
| ⌘E | Export PDF… |

---

## Troubleshooting

**Citations show as plain `[@key]` text with no References section.** No
bibliography is loaded at all. Either the document has no `bibliography:` key
in its frontmatter, or it has never been saved.

**A citation shows red as `[@key?]`.** The bibliography loaded fine, but that
key is not in it. This is the healthy failure — the rest of the document still
renders.

**The frontmatter shows up as a heading in the preview.** The block is not
being recognised. It must start on the very first line, and both fences must be
exactly `---` on a line of their own.

**Charts do not render.** The fence must be tagged exactly `vega-lite` and the
block must contain valid JSON.

---

## Project layout

```
main.go               Wails app setup, services, window, events
menu.go               Application menu
documentservice.go    File I/O, recents, dirty tracking, bibliography, PDF
zotero.go             Better BibTeX picker (CAYW) client
frontend/src/
  App.svelte          Orchestrates panes, toolbar, status bar
  Editor.svelte       CodeMirror instance
  Preview.svelte      Rendered output and chart hydration
  lib/renderer.ts     markdown-it + KaTeX + citation pipeline
  lib/citations.ts    Citation parsing and CSL formatting
  lib/bibliography.ts BibTeX to CSL-JSON
docs/
  test-document.md    Manual verification document — every feature, in order
  zotero-export-text.bib  Bibliography for it, auto-synced from Zotero
  sample-data.csv     Table for exercising the chart builder's importer
  superpowers/        Design specs and implementation plans
```

Recent files are stored in your XDG data directory as `hermes/recents.json`.

## Development

```bash
cd frontend && npm test        # Vitest suite
cd frontend && npm run check   # svelte-check, must stay at 0 errors
go test ./. && go build -o /dev/null .   # note ./. not ./...
wails3 task common:generate:bindings     # after changing a service API
```

`docs/test-document.md` is the manual counterpart to the test suites: open it
in Hermes after any substantial change and work down it. Each section states
what correct looks like, so a wrong result is visible without knowing the
implementation, and the last section is meant to look broken. Section 10 is
the quickest way to see citations working — every supported form, plus the
deliberate error cases.

## Known limitations

- macOS only for now.
- Light theme only; a dark theme is on the backlog.
- The startup pane has no visible Open button — use ⌘O until that is fixed
  in v0.4.
- PDF export goes through the system print panel rather than rendering
  headlessly.

## Licence and credits

Hermes is licensed under the [Apache License, Version 2.0](LICENSE).
Copyright 2026 Craig Richards.

Two bundled components carry obligations of their own, both recorded in
[NOTICE](NOTICE):

- Citation formatting uses [citeproc-js](https://github.com/Juris-M/citeproc-js),
  copyright Frank Bennett, which is dual-licensed under **either** the Common
  Public Attribution License v1+ **or** the GNU Affero General Public License
  v3+, at the licensee's option. **Hermes elects the CPAL option**, which is
  file-scoped copyleft and so does not extend to the rest of this codebase.
  Its licence text is at `licenses/citeproc-js.LICENSE`.
- The bundled CSL styles and locale come from the
  [Citation Style Language](https://github.com/citation-style-language) project
  under CC-BY-SA-3.0; see `frontend/src/assets/csl/LICENSE.md`.

Every other dependency is permissively licensed (MIT, BSD-3-Clause or ISC).

Built with [Wails v3](https://v3.wails.io), [Svelte 5](https://svelte.dev),
[CodeMirror 6](https://codemirror.net), [markdown-it](https://github.com/markdown-it/markdown-it),
[KaTeX](https://katex.org), [Vega-Lite](https://vega.github.io/vega-lite/), and
[Mermaid](https://mermaid.js.org).
