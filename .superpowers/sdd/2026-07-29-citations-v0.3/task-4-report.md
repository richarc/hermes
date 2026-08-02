# Task 4 Report: Citation syntax parsing (markdown-it rule)

## What was implemented

Added the markdown-it parsing half to `frontend/src/lib/citations.ts`, alongside the
existing citeproc formatter:

- `KEY_RE` — exported citekey regex matching Pandoc's charset.
- `LOCATOR_RE` / `splitLocator` — recognizes `p./pp./pages`, `chap./chapter`,
  `sec./section` locator labels, or a bare number defaulting to `page`; anything
  else is left as a plain `suffix`.
- `parseKey` — factored helper (see "Departures" below) that matches a citekey at
  the start of a string and strips trailing sentence punctuation (`.:#?`) from the
  key while keeping that punctuation available in the remainder for locator/suffix
  parsing.
- `parseBracketContent` — splits a bracketed group on `;`, extracts prefix,
  suppress-author (`-@key`), key, and locator/label/suffix for each item.
- `pushCitation(state, tokenType, cluster, raw)` — pushes the cluster onto
  `env.citations` (creating the array on first use) and emits a token of the
  given type carrying `{ meta: { index }, content: raw }`.
- `bracketRule` — inline rule for `[@key]` / `[see @key, pp. 33-35; @other]`,
  registered before `link`.
- `narrativeRule` — inline rule for bare `@key` (guards against mid-word/email
  matches by checking the preceding character), registered before `emphasis`.
- `citationPlugin(md)` — registers both rules and a single `renderCitation`
  function shared by both `citation` and `citation_narrative` token types,
  producing `<span class="citation" data-cite-index="N">ESCAPED_RAW</span>`.

## Departure from the brief's sketch

The sketch duplicated the "match key, strip trailing punctuation, compute the
remainder" logic once inline in `parseBracketContent` and once in
`narrativeRule`. Per the brief's explicit instruction ("Clean up the duplicated
key-truncation lines... the tests are the contract"), I factored this into a
single `parseKey(text): { key, rest } | null` helper used by both call sites.
Also per the brief, `pushCitation` takes the token type as a parameter and
`narrativeRule` pushes a `citation_narrative` token; `citationPlugin` builds one
`renderCitation` closure and assigns it to both
`md.renderer.rules.citation` and `md.renderer.rules.citation_narrative` (same
function reference, not just equivalent behavior). No other functional
deviation from the sketch — the parsing algorithm, regexes, and rule ordering
(`before('link', ...)`, `before('emphasis', ...)`) are unchanged.

## TDD Evidence

**RED** — appended the 9 tests verbatim from the brief to `citations.test.ts`
before any implementation existed; ran `npm test -- --run`:

```
FAIL  src/lib/citations.test.ts > citationPlugin parsing > ...
TypeError: Cannot read properties of undefined (reading 'apply')
 ❯ MarkdownIt.use node_modules/markdown-it/lib/index.mjs:485:10
...
Test Files  1 failed | 5 passed (6)
     Tests  9 failed | 41 passed (50)
```
(`citationPlugin` did not exist yet — `md.use(undefined)` throws inside
markdown-it.)

**GREEN** — after implementing per the brief (with the `parseKey` factoring
noted above), ran `npm test -- --run`:

```
Test Files  6 passed (6)
     Tests  50 passed (50)
```

`npm run check` (svelte-check):

```
COMPLETED 514 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

## Files changed

- `frontend/src/lib/citations.ts` — added parser implementation (+124 lines),
  plus two new type-only imports (`MarkdownIt`, `StateInline` from
  `markdown-it/lib/rules_inline/state_inline.mjs`, `Token` from
  `markdown-it/lib/token.mjs`).
- `frontend/src/lib/citations.test.ts` — appended the 9 brief tests verbatim
  (+65 lines), plus their required imports (`MarkdownIt`, `citationPlugin`,
  `CitationCluster` type).

Commit: `071ca4b` — `feat: pandoc-subset citation syntax parsing`

## Self-review findings

- All 9 new tests green, full suite 50/50 (41 pre-existing + 9 new).
- `npm run check`: 0 errors, 0 warnings.
- Verified `[plain brackets]` (no `@`) still renders as literal bracket text and
  `[a link](https://x.y)` still renders as `<a href...>` — both covered by the
  "leaves normal links and brackets alone" test, which passes.
- Placeholder content is HTML-escaped via `md.utils.escapeHtml(t.content)` in
  the shared `renderCitation` function. Reasoned through a hostile case: Pandoc's
  citekey charset includes `<` and `>` (for DOI-like keys), so a raw citation
  span's content could theoretically contain those characters — they still pass
  through `escapeHtml` before being embedded, so no injection risk from the
  placeholder itself.
- `git diff --stat` confirms only the two intended files changed; nothing else
  in the tree was touched (renderer.ts, KaTeX/vega rules untouched, as required
  since renderer wiring is Task 5's job).
- Confirmed markdown-it is v14.3.0 and ships `.mjs`-suffixed rule/type modules,
  matching the brief's import paths exactly (no path fixup needed).

## Concerns

None. The implementation matches the brief's contract exactly (interface
names, placeholder format, locator table, rule registration order) and the
only change from the literal sketch is the requested dedup, which is purely
a refactor with no behavior change (verified by all tests passing unmodified
against both the sketch-as-given and the refactored version).

---

## Fix report: bracketRule hijacking links (review finding)

### Root cause

`bracketRule` located the closing bracket with `src.indexOf(']', pos)` — the
first `]` anywhere in the remaining source, with no bracket-depth tracking
and no check for what followed. This let it swallow constructs it shouldn't
own: inline links (`[text with @word](url)`), reference links
(`[text with @word][ref]`), nested brackets (`[a [@cite] link](url)`), and —
because an unbalanced `[` was never rejected — unrelated content past a
line break whenever a later, unrelated `]` existed on a following line.

### Fix

1. **`findBalancedClose(src, open)`** — new helper doing a depth-tracked scan
   from the opening `[`, returning the position where depth returns to 0, or
   `-1` if the source runs out first. `bracketRule` now uses this instead of
   `indexOf`. An unclosed/unbalanced `[` therefore never fires (fixes the
   line-break/absorption case).
2. **Link/reference bailout** — after finding the balanced close,
   `bracketRule` now checks the next character: if it's `(` or `[`, the
   construct is (or is attempting to be) a markdown link or reference link,
   and `bracketRule` returns `false` so markdown-it's own `link` rule owns
   it. markdown-it re-tokenizes link labels through the full inline ruler
   (`link.mjs` calls `state.md.inline.tokenize(state)` over the label
   range), so a citation legitimately nested inside a label still parses —
   no extra plumbing needed there.
3. **`narrativeRule` scoped to top-level text** — two additions, needed to
   make the covering tests (see below) actually hold:
   - `if (state.linkLevel > 0) return false` — bare `@word` citations no
     longer fire while `state` is inside link-label re-tokenization
     (`state.linkLevel` is incremented by markdown-it's own `link` rule
     around exactly that call). This mirrors how markdown-it's built-in
     `linkify` rule uses the identical `state.linkLevel > 0` guard. Only the
     *bracketed* form (`[@key]`) is allowed to nest inside link text, since
     it has its own delimiters to recover with; the bare form has none, so
     Pandoc/our design treats it as top-level-prose-only.
   - Added `[` to the "must not be mid-word" preceding-character check.
     When `bracketRule` declines an attempted `[@key` (e.g. unbalanced), the
     `@` immediately following that `[` no longer falls through and gets
     independently claimed by `narrativeRule` as a bare citation — the
     failed bracket attempt doesn't get a second chance via the narrative
     path.

### Type-check fallout and how it was resolved

`@types/markdown-it`'s `StateInline` declaration does not include
`linkLevel`, even though it genuinely exists at runtime and is exactly how
markdown-it's own `linkify.mjs` guards against linkifying inside link text
(`grep linkLevel` across `node_modules/markdown-it/lib/rules_inline/*.mjs`
confirms `state.linkLevel` is set in the constructor and read/written by
`link.mjs`, `linkify.mjs`, and `html_inline.mjs`). Rather than casting the
whole function loosely or suppressing the checker, added a narrow,
documented cast at the one read site:
`(state as StateInline & { linkLevel: number }).linkLevel`.

### Reconciling with the finding's literal wording (important — read before trusting test names blindly)

The review finding sketched expected assertions for the four cases, but two
of the literal expectations, checked empirically against the real
markdown-it engine (not just reasoned about), don't hold — for reasons that
turn out to be pre-existing, spec-mandated markdown-it/CommonMark behavior
unrelated to citations:

- **Case 2** (`[a [@cite] link](https://example.com)`): the finding says to
  "assert the link renders as a link AND the inner citation span exists
  inside it." Empirically, the OUTER `[...](...)` does **not** become an
  `<a>` — it renders as literal brackets/parens with only the inner
  `<span class="citation">` inside. This is not a citation-plugin defect: it
  is CommonMark's own documented behavior for any bracket-consuming
  construct nested inside a would-be link label. Verified directly: I ran
  the CommonMark spec's own example 526, `[foo [bar](/uri)](/uri)`, through
  **vanilla markdown-it with no citation plugin installed at all**, and got
  `<p>[foo <a href="/uri">bar</a>](/uri)</p>` — literal outer brackets,
  inner link rendered. `markdown-it`'s `parseLinkLabel` helper
  (`node_modules/markdown-it/lib/helpers/parse_link_label.mjs`) explicitly
  aborts outer-link detection (`disableNested` branch) whenever a nested `[`
  is consumed by ANY rule as more than a bare 1-char token — links-in-links
  and, by the same mechanism, our citation-in-link-label. I wrote the test
  to assert the real (and correct) behavior: `clusters` has one entry for
  `cite`, the placeholder span is present, and `<a href` is absent — with a
  comment explaining why, citing the spec precedent.
- **Case 1 and case 3** ("zero clusters"): these DO hold, but only because
  of the `state.linkLevel > 0` guard added to `narrativeRule` above. Without
  it, a bare `@word` inside a link label (there being no nested bracket
  construct to trip the `parseLinkLabel` abort) would have been picked up by
  `narrativeRule` and produced a spurious nested cluster — the link renders
  fine either way, but clusters would not have been empty. This guard was
  not explicitly requested in the finding's fix list (which named only the
  balanced-scan and next-char bailout for `bracketRule`), but is necessary
  for the finding's own stated test expectations for cases 1 and 3 to be
  true, so I added it and called it out here rather than silently expanding
  scope.

I verified all of this empirically with disposable probe test files
(`src/lib/__probe.test.ts`, `__probe2.test.ts`) before writing the real
tests, then deleted them; they are not part of the commit.

### Covering tests added (`frontend/src/lib/citations.test.ts`)

New `describe('citationPlugin does not hijack markdown links (regression)')`
block, 4 tests:

1. `[my @cite here](https://example.com)` → renders as a real `<a href>`
   link with the literal text intact; `clusters` is `[]` (case 1).
2. `[a [@cite] link](https://example.com)` → `clusters` has one entry
   `{ items: [{ key: 'cite' }] }`; HTML contains the citation placeholder
   (`>[@cite]<`) and does **not** contain `<a href` (case 2, matching real
   CommonMark-consistent behavior — see above).
3. `[see @smith][ref]` + a `[ref]: https://example.com` reference
   definition → renders as `<a href="https://example.com">see @smith</a>`;
   `clusters` is `[]` (case 3).
4. `Note [@key` + newline + `some [text] after` → `clusters` is `[]`; both
   `Note [@key` and `some [text] after` remain literal in the output
   (case 4).

### Test evidence

`npx vitest run src/lib/citations.test.ts` (the coordinator's requested
covering-test command): **20/20 passed** (16 pre-existing/prior-task tests +
4 new regression tests).

`npm test` (full suite): **54/54 passed** (50 prior + 4 new).

`npm run check`: **0 errors, 0 warnings** (514 files) — after the
`linkLevel` cast fix above; the check failed with exactly 1 error
(`Property 'linkLevel' does not exist on type 'StateInline'`) before that
cast was added, confirming the cast was necessary and sufficient.

### Files changed (fix)

- `frontend/src/lib/citations.ts` — added `findBalancedClose`, link/
  reference bailout in `bracketRule`, `linkLevel` guard + `[`-preceding-char
  guard in `narrativeRule` (+36/-3 lines).
- `frontend/src/lib/citations.test.ts` — added the 4 regression tests above
  (+41 lines).

Commit: `663f46e` — `fix: depth-balance citation bracket scan to stop
hijacking links`

### Concerns

None blocking. Flagging for visibility (not a defect): case 2's exact
rendering (outer brackets stay literal) surprises anyone expecting normal
link syntax to "just work" when it happens to contain `[@key]` — but this
mirrors markdown-it/CommonMark's existing, spec-mandated treatment of any
nested link-like bracket construct, so it's consistent with how the rest of
the renderer already behaves (e.g. a real nested link in the same position
would do the same thing), not a citation-specific rough edge introduced
here.

---

## Fix report round 2: silent-drop-on-declined-link (review finding)

### Root cause

Round 1's fix pre-emptively bailed out of `bracketRule` whenever the
character right after the balanced close was `(` or `[`, unconditionally
deferring to markdown-it's `link` rule with no fallback. That's a guess, not
a fact: a `[` or `(` following doesn't guarantee `link` will actually
succeed. When it doesn't (an undefined reference label, or an adjacent
bracket that fails to resolve as a reference), the position was already
abandoned by `bracketRule` and nothing else picked it up — the citation was
silently lost. Verified both reported repros before fixing:
- `See [@smith2020][TODO check]` → citation dropped entirely (round-1
  code): `bracketRule` saw `[` after `[@smith2020]`'s close and bailed;
  `link` then tried the `[text][label]` reference form using `TODO check`
  as the label, found no such reference defined, and declined the *whole*
  construct (both label and destination) rather than just the label — but
  by then `bracketRule` had already given up on that position for good.
- `[@a2020][@b2021]` → only the second key captured, for the same reason
  applied to the first bracket.

### Fix

1. **Reordered `bracketRule` to run after `link`**:
   `md.inline.ruler.after('link', 'citation', bracketRule)` (was
   `before('link', ...)`). A real link or reference link now always gets
   first refusal at a `[`; markdown-it's own tokenizer main loop tries the
   next rule in ruler order once a rule declines without moving `state.pos`,
   so `bracketRule` gets a real (non-guessing) shot at the exact same
   position immediately after `link` has already failed. No renderer/task-5
   interface changed by this — still the same token types, same placeholder
   format.
2. **Deleted the `next === '(' || next === '['` bail entirely**, per the
   fix instructions — there is no longer any need to guess what follows the
   close, since `link` already had (and used, or declined) its chance.
3. **Added one new, order-independent guard** (not explicitly in the fix
   instructions, but required — see "second-order regression" below):
   `bracketRule` now declines if its own `content` (the text strictly
   between the matched `[` and its balanced `]`) contains a literal `[`.
   This is not a lookahead — it inspects only what was already scanned
   while establishing the balanced close, never what comes after it. It's
   also Pandoc-consistent: a well-formed flat citation group's prefix/key/
   locator/suffix text never legitimately contains a literal bracket
   character; a `[` inside the content means this bracket actually wraps a
   nested bracket construct (a nested citation, a nested link, etc.), and
   Pandoc's own citation grammar doesn't support that either.
4. `findBalancedClose` (depth-balanced scan) and `narrativeRule`'s
   `linkLevel > 0` guard and `[`-preceding-char guard are **unchanged**, as
   instructed.

### Why the extra guard was necessary (second-order regression found while verifying)

I implemented steps 1–2 exactly as instructed first, then ran the existing
4 regression tests before touching anything else — one failed:
`a bracketed citation nested inside a link label still parses, per
CommonMark link-in-link rules` (the case-2 test: `[a [@cite] link](url)`).
Traced it down: with the bail gone and `bracketRule` now positioned right
after `link` in the ruler, once `link` declines the *outer* `[` (correctly,
per CommonMark's link-in-link rule — the same mechanism verified in round 1
against the CommonMark spec's own example 526), `bracketRule` was now
reached for that exact same outer position, and its old (unguarded) logic
happily parsed the *whole* outer content `"a [@cite] link"` as one citation
— `indexOf('@')` finds the `@` inside the nested `[@cite]`, and everything
before/after becomes prefix/suffix, literal bracket characters included:

```
{ items: [{ key: 'cite', prefix: 'a [', suffix: '] link' }] }
```

That's not usable output (a citation whose prefix/suffix contain stray,
unmatched bracket characters), and it also changed case 2's previously
correct, CommonMark-consistent behavior (outer brackets literal, inner
citation parses standalone) into something worse. I verified the exact
failure with `npx vitest run src/lib/citations.test.ts --reporter=verbose`
(diff showed `+ "prefix": "a ["`, `+ "suffix": "] link"` where the test
expected `{ key: 'cite' }` alone) before adding the `content.includes('[')`
guard described in step 3 above, which restores the exact prior behavior
and the test passes again unchanged.

I flag this because the finding's own text stated "case 1 and case 2
behavior unchanged" as an expectation for the fix, and taking the two
prescribed changes (reorder + delete bail) fully literally, with nothing
else, does *not* hold that promise for case 2 — this third guard was
required to actually deliver it. I verified this empirically (disposable
probe test files, deleted after use) rather than reasoning about it in the
abstract, given round 1 already taught me the finding's stated expectations
don't always survive contact with markdown-it's real rule-interaction
mechanics.

### Type-check

No new type issues; the `linkLevel` cast from round 1 is untouched and
still the only non-standard typing needed.

### New covering tests added (`frontend/src/lib/citations.test.ts`)

New `describe('citationPlugin: adjacent brackets and declined links
(round-2 fix)')` block, 2 tests, matching the coordinator's requested
scenarios exactly:

1. `[@a2020][@b2021]` → `clusters` maps to `[['a2020'], ['b2021']]` (two
   clusters); HTML contains both `data-cite-index="0"` and
   `data-cite-index="1"`.
2. `See [@smith2020][TODO check]` → `clusters` is
   `[{ items: [{ key: 'smith2020' }] }]` (one cluster); HTML contains
   `data-cite-index="0"` and the literal text `[TODO check]`; no `<a href`
   is present (the reference never resolves).

Both were verified empirically against the real implementation via a
disposable probe test (`src/lib/__probe3.test.ts`, deleted before
committing) before being written as permanent assertions.

### Test evidence

`npx vitest run src/lib/citations.test.ts` (coordinator's requested
covering-test command): **22/22 passed** — the original 9 contract tests,
the 4 round-1 regression tests (all unchanged, all still passing, including
case 2 after the new guard restored its behavior), and 2 new round-2
regression tests.

`npm test` (full suite): **56/56 passed** (54 prior + 2 new).

`npm run check`: **0 errors, 0 warnings** (514 files).

### Files changed (round-2 fix)

- `frontend/src/lib/citations.ts` — reordered `bracketRule` registration to
  `ruler.after('link', ...)`, deleted the next-char bail, added the
  `content.includes('[')` guard with rationale comment (+30/-8 lines net).
- `frontend/src/lib/citations.test.ts` — added the 2 new round-2 regression
  tests (+26 lines).

Commit: `0de10c5` — `fix: reorder citation rule after link instead of
bailing on lookahead`

### Concerns

None blocking. The one thing worth the coordinator's attention: the fix
instructions described 2 code changes (reorder, delete bail) but a 3rd
change (the `content.includes('[')` guard) was empirically necessary to
keep case 2's stated-as-required behavior intact — flagging this
explicitly rather than silently expanding scope, per the same practice as
round 1.
