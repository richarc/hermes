# Hermes v0.3 — Citations and Bibliography: Design

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan

## Overview

v0.3 adds academic citations to Hermes: Pandoc-style `[@key]` markup rendered
through CSL, a per-document BibTeX bibliography, and first-class Zotero
integration via the Better BibTeX (BBT) plugin — a citation picker for
inserting keys and a BBT-maintained `.bib` file that Hermes watches for
changes. Rendering remains entirely in the frontend, consistent with the v0.1
architecture.

## Goals

- Cite with the practical Pandoc subset: `[@key]`, multiples `[@a; @b]`,
  narrative `@key`, suppress-author `[-@key]`, prefixes/suffixes/locators
  (`[see @key, pp. 33-35]`).
- Per-document bibliography: YAML frontmatter names a `.bib` file; entries
  parsed to CSL-JSON; a formatted References section appended to the preview
  and the printed PDF.
- Bundled CSL styles selected in frontmatter: `apa` (default),
  `chicago-author-date`, `ieee`, `vancouver`, `harvard`.
- Zotero/BBT integration: insert citations through Zotero's CAYW picker
  (toolbar button, File → Insert Citation…, ⌘⇧C); auto-refresh the preview
  when BBT's auto-export rewrites the `.bib`.
- Errors render visibly in place; a broken or missing bibliography never
  blanks the preview.

## Non-goals

- Zotero's plugin-free local API (`localhost:23119/api/`): without BBT there
  are no citekeys, so it cannot serve the `[@key]` workflow. Backlog.
- Zotero Web API (cloud), citation styles beyond the bundled five, arbitrary
  `.csl` files from disk, footnote citation styles requiring footnote
  rendering, and multi-bibliography documents. All future candidates.
- Editing/managing the reference library from Hermes — Zotero owns that.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | citeproc-js, used directly | The reference CSL implementation — Zotero itself runs it; output matches what academics expect. AGPL-licensed: acceptable for personal use, revisit before commercial distribution. |
| `.bib` parser | `@retorquere/bibtex-parser` | Better BibTeX's own parser; highest-fidelity round-trip of BBT-generated files. |
| Data source | Document-named `.bib`, maintained by BBT auto-export | Documents stay portable and render offline; BBT keeps the file current; Hermes only ever reads it. |
| Insertion | BBT CAYW endpoint (`http://127.0.0.1:23119/better-bibtex/cayw?format=pandoc`) | Native Zotero picker UX; returns Pandoc-formatted keys ready to insert. Manual typing always works. |
| Styles | Five bundled CSL styles + `en-US` locale, chosen by frontmatter id | Covers common needs without style-repository plumbing. |
| Watching | Go-side mtime/size polling (2 s) in one service-owned goroutine | No new dependency; BBT rewrites are detected promptly; missing files self-heal. |

## Frontmatter

```markdown
---
bibliography: refs.bib
csl: apa
---
```

- Leading `---` block, only at the very start of the document; stripped from
  rendered output.
- `bibliography`: path to the `.bib`, resolved relative to the document's
  directory (absolute paths allowed).
- `csl`: one of the bundled style ids; missing or unknown values fall back to
  `apa` (unknown values also toast).
- Parsing is a minimal `key: value` line parser for these two keys — no YAML
  dependency.

## Architecture and data flow

**Loading:** on document open (and on `bib:changed`), App parses frontmatter,
calls `ReadBibliography` through the Go bindings, parses the returned BibTeX
to CSL-JSON in the frontend, and passes `{ entries, style }` into the
renderer. The citeproc engine instance is cached and rebuilt only when the
entries or style change; per-keystroke renders reuse it inside the existing
250 ms debounced pipeline.

**Rendering (two-phase, still a pure function):**
`render(markdown, opts?)` where `opts` carries entries and style.
1. A markdown-it inline rule tokenizes citation groups into indexed
   placeholder spans, collecting each group (keys, prefix, suffix, locator,
   suppress flag) in document order via the render env.
2. After the HTML pass, citeproc-js processes the clusters in order (whole-
   document processing is required for disambiguation and repeat-citation
   forms), the placeholders are substituted with formatted in-text citations,
   and — when at least one citation exists — a References section
   (`<h2>References</h2>` + citeproc bibliography HTML) is appended.

Documents without citations and calls without `opts` render exactly as v0.2.

**Insertion (CAYW):** toolbar Cite button / File → Insert Citation… (⌘⇧C) →
frontend calls the `PickCitations` binding → Go GETs the CAYW endpoint →
Zotero's picker appears → the returned string (e.g. `[@smith2020; @doe2021]`)
is inserted at the editor cursor via a new `Editor.insertAtCursor(text)`.
Cancel returns an empty string and inserts nothing.

## Components

### Go

- `ReadBibliography(path, docPath string) (string, error)` — resolves `path`
  against `filepath.Dir(docPath)` when relative; returns file contents.
- `WatchBibliography(path, docPath string)` — returns immediately; (re)arms
  the watcher goroutine. Exactly one watcher lives at a time: the service
  holds a `context.CancelFunc` (mutex-guarded); re-arming or watching an
  empty path cancels the previous goroutine. The goroutine ticks every 2 s,
  `os.Stat`s the resolved path, compares mtime+size to the last observation,
  and emits `app.Event.Emit("bib:changed")` on difference. A missing file
  keeps polling and emits when it appears (self-healing). No shutdown
  handling needed beyond process exit.
- `PickCitations() (string, error)` — GET `{caywBase}/better-bibtex/cayw?format=pandoc`
  with a long timeout (the user is interacting with a picker; e.g. 5 min).
  `caywBase` is a service field defaulting to `http://127.0.0.1:23119`,
  injectable for tests. Connection errors surface to the frontend.
- `menu.go`: File → Insert Citation… (`cmdorctrl+shift+c`) emitting
  `menu:insert-citation`.

### Frontend

- `lib/frontmatter.ts` — `parseFrontmatter(markdown) → { body, bibliography?,
  csl? }`.
- `lib/bibliography.ts` — wraps `@retorquere/bibtex-parser`:
  `parseBib(text) → { entries: CSLEntry[], warnings: string[] }`.
- `lib/citations.ts` — the markdown-it citation rule + citeproc wrapper:
  engine construction from entries/style (styles and `locales-en-US` imported
  as raw XML assets), cluster processing, bibliography formatting, unknown-key
  detection.
- `renderer.ts` — integrates frontmatter stripping and the two-phase citation
  pass; signature `render(markdown: string, opts?: RenderOptions): string`.
- `Editor.svelte` — `insertAtCursor(text: string)` (CodeMirror
  `replaceSelection`, cursor ends after the insertion).
- `App.svelte` — frontmatter-driven bib load/watch wiring, `bib:changed` and
  `menu:insert-citation` handlers, Cite toolbar button, error toasts.

## Error handling

The standing rule: errors render visibly in place; the preview never blanks.

- Unknown citekey → that key renders as `[@key?]` with the existing error
  styling; the rest of the group and document render normally.
- Frontmatter names a missing/unreadable `.bib` → toast; citations render in
  error style; the watcher's self-healing picks the file up when it appears.
- `.bib` parse warnings → non-blocking toast with a count; parseable entries
  still resolve.
- Unknown `csl` id → toast + APA fallback.
- CAYW failure (Zotero closed, BBT absent) → toast: "Zotero (with Better
  BibTeX) isn't running".

## Testing

- **Renderer/citations (Vitest, fixture `.bib`):** every supported syntax
  form; disambiguation (two same-author-same-year entries); unknown keys;
  each bundled style smoke test; References section present only when
  citations exist; frontmatter stripped; documents without citations
  byte-identical to the v0.2 pipeline output.
- **Go:** path resolution and read errors for `ReadBibliography`; watcher
  emits on mtime change and survives a missing file (short ticks in tests);
  `PickCitations` against an `httptest` server returning canned keys and
  simulating connection failure.
- **Manual (GUI):** real CAYW picker round-trip; BBT auto-export → preview
  refresh; PDF export with a References section; visual test document
  extended with a citations section plus a committed `docs/visual-test.bib`.

## Release

Ships as v0.3.0: changelog entry, roadmap tick, `build/config.yml` bump,
tag — same release mechanics as v0.2.0.
