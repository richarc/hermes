# Task 5 Report: Renderer integration (two-phase citation pass)

## What I implemented

Followed the brief's sketch essentially verbatim in `frontend/src/lib/renderer.ts`:

- `render(markdown, opts?)` now first calls `parseFrontmatter(markdown)` and renders only `body` — frontmatter is stripped unconditionally, before the formatter branch, so both the with-formatter and without-formatter paths get stripped bodies from the same code path (no duplication/divergence possible).
- `citationPlugin` is registered on the shared `md` instance at module load (`md.use(citationPlugin)`), so citation spans (`.citation` / raw text) always appear even when no formatter is supplied — matching "without opts.formatter, citations render as their raw text in `.citation` spans (no error, no bibliography)".
- With a formatter: clusters are partitioned into resolvable (all keys known) vs not; unresolvable ones are blanked to `{ items: [] }` before calling `formatter.format` so citeproc's index alignment (`texts[i] = ''` for blanked clusters) is preserved — relying on the hardening already present in `citations.ts`'s `format()` (empty-cluster skip-and-continue, `submittedToOriginal` index mapping).
- Placeholder spans are replaced via regex over the rendered HTML: resolvable clusters get `<span class="citation">{formatted text}</span>`; unresolvable ones get `<span class="cite-error">[@key] [@key2?]</span>` where each item is individually marked `?` only if `formatter.has(key)` is false (so a group with one bad key among several good ones still shows which specific key failed).
- The `<h2>References</h2>` + bibliography HTML is appended exactly once, gated on `clusters.some(resolvable)` — a single string concatenation after the replace pass, not inside any loop, so it can never be duplicated regardless of how many resolvable clusters exist.

No departures from the sketch — `citations.ts` already had `has(key)` and the empty-cluster tolerance in `format()` from Task 3/4's review hardening, exactly as the brief anticipated ("this was hardened in review — rely on it"), so Step 2 required no changes outside `renderer.ts`.

## TDD Evidence

**RED** — added the 6 tests verbatim from the brief to `renderer.test.ts` (plus the `ENTRIES`/`FORMATTER` fixtures and imports), ran `npx vitest run src/lib/renderer.test.ts`:

```
Test Files  1 failed (1)
     Tests  3 failed | 15 passed (18)
```
Failures were the 3 new-behavior tests (frontmatter-strip presence pre-existed and passed trivially since `render` didn't strip frontmatter at all before this change — actually all 3 citation-formatter-dependent tests failed as expected: "strips frontmatter..." failed because frontmatter wasn't stripped yet, "renders formatted citations..." and "renders unknown keys..." failed because `render` didn't accept `opts` / did no substitution).

**GREEN** — after implementing `render` per the sketch:
```
Test Files  1 passed (1)
     Tests  18 passed (18)
```
Full suite: `npx vitest run` → `Test Files 6 passed (6)`, `Tests 62 passed (62)` (56 pre-existing + 6 new).

`npm run check` → `COMPLETED 514 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.

`npm run build` → succeeded (only a pre-existing chunk-size advisory warning, unrelated to this change, no errors).

## Files changed

- `frontend/src/lib/renderer.ts` — added `parseFrontmatter`/citation imports, registered `citationPlugin`, added `RenderOptions`, rewrote `render()` for the two-phase pass, added `resolvable()` helper.
- `frontend/src/lib/renderer.test.ts` — appended the brief's `describe('render: citations', ...)` block verbatim (6 tests) plus its fixtures/imports.

## Self-review

- Frontmatter stripped in both paths: yes — `parseFrontmatter` runs once before the `formatter` branch; both the early return (`!formatter || clusters.length === 0`) and the full substitution path operate on the same already-stripped `html`.
- References heading appended exactly once, only when a resolvable citation exists: yes — single `if (clusters.some(resolvable)) html += ...` after the replace pass; verified by test "adds no References section when the document has no citations" and "renders raw citation text without a formatter, no References" (formatter absent) both passing, and the byte-identical-render test passing (no formatter branch is entered at all when `clusters.length === 0`, so `opts.formatter` present but unused for citation-less docs renders identically to no-opts).
- Unknown-key error rendering: verified group-level partial marking (`[@nope2000?]` while `[@smith2020]` in the same or a different cluster with a good key stays a real error-not-triggered path) — test asserts `cite-error`, `[@nope2000?]`, and that the resolvable cluster's formatted text (`Smith...2020`) still appears elsewhere in the doc.
- No changes were needed to `citations.ts` — its `has()` and empty-cluster `format()` handling were already in place from the prior tasks' review pass, confirmed by reading the file before starting.
- Git diff is scoped to exactly the two files named in the brief; no stray changes.

## Concerns

None. All existing 56 tests plus the 6 new tests pass (62/62), `npm run check` is clean, `npm run build` succeeds.

---

## Fix report: Critical review finding (HTML injection via unescaped citekey)

**Finding:** `renderer.ts:49` interpolated `it.key` raw into the `.cite-error` HTML string. `KEY_RE` in `citations.ts` deliberately permits `&`, `<`, `>` (Pandoc's citekey charset), so an unresolvable citation like `[@bad&x<y>z]` would inject literal `<y>` markup into the DOM — inconsistent with the escaping discipline used everywhere else in the render pipeline (e.g. `citationPlugin`'s own `renderCitation` already escapes `t.content`).

**Fix applied** (`frontend/src/lib/renderer.ts`, inside the `.replace` callback's error branch):
- Wrapped `it.key` with `md.utils.escapeHtml(...)` when building each `[@key?]` marker for an unresolvable cluster.
- Wrapped the `raw` fallback (used when `cluster` is unexpectedly absent at that index — a defensive-only branch, since `clusters[i]` always matches the span emitted from the same `md.render` call) with `md.utils.escapeHtml(...)` too, for defense-in-depth as requested. Note: `raw` is actually captured from HTML already escaped once by `citationPlugin`'s renderer (it matches the literal span *inner HTML*, which was produced via `md.utils.escapeHtml(t.content)`), so this fallback branch double-escapes in the (unreachable in practice) case it fires — accepted as a deliberate, harmless trade-off per the review's explicit instruction, since the branch is dead code in normal operation and the alternative (leaving one raw-interpolation branch unescaped) is a worse-shaped invariant to maintain.

**Covering test added** (`frontend/src/lib/renderer.test.ts`, `render: citations` describe block):
```ts
it('escapes HTML-significant characters in an unresolvable citekey', () => {
  const html = render('Weird [@bad&x<y>z].', { formatter: FORMATTER })
  expect(html).toContain('cite-error')
  expect(html).toContain('&amp;x&lt;y&gt;z?')
  expect(html).not.toContain('<y>')
})
```

**TDD evidence for the fix:**
- RED: temporarily reverted the `escapeHtml` wrapping in `renderer.ts` (restoring the vulnerable interpolation) and ran `npx vitest run src/lib/renderer.test.ts -t "escapes HTML-significant"` — failed as expected:
  ```
  AssertionError: expected '<p>Weird <span class="cite-error">[@b…' to contain '&amp;x&lt;y&gt;z?'
  + <p>Weird <span class="cite-error">[@bad&x<y>z?]</span>.</p>
  ```
  confirming the raw `<y>` was present unescaped in the output before the fix.
- GREEN: restored the fix, re-ran `npx vitest run src/lib/renderer.test.ts` → `Tests 19 passed (19)` (18 prior + 1 new).
- Full suite: `npm test` → `Test Files 6 passed (6)`, `Tests 63 passed (63)`.
- `npm run check` → `0 ERRORS 0 WARNINGS`.
- `npm run build` → succeeded (same pre-existing chunk-size advisory, no errors).

**Commit:** `4ae7896` — "fix: escape citekeys in .cite-error markup to prevent HTML injection"

**Concerns:** None remaining. The fix is scoped to the two files already owned by this task; no other files touched.
