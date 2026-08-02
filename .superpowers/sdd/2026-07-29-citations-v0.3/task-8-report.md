# Task 8 Report: Editor insertion + App wiring

## What was implemented

Followed the brief step by step:

1. **`frontend/src/Editor.svelte`** — added `insertAtCursor(text: string)` below `setContent`, exactly as specified: `view.dispatch(view.state.replaceSelection(text)); view.focus()`. Verified `EditorView.state.replaceSelection` exists in `@codemirror/state` (`node_modules/@codemirror/state/dist/index.d.ts:1129`).

2. **`frontend/src/App.svelte`**:
   - Imported `parseFrontmatter`, `parseBib`, `createCitationFormatter`, `STYLE_IDS`, `CitationFormatter`, and `untrack` from `svelte`.
   - Added `formatter` and `bibPath` state, `fm` derived from `content`.
   - Added `reloadBibliography()` per the brief (unknown-csl toast wired in via `STYLE_IDS`).
   - Added the "reload on bibliography/csl/path change" effect and the "re-render on formatter change" effect (with `untrack(() => content)`, per the required pattern).
   - Added `insertCitation()`.
   - Updated both render call sites (`updatePreview`, `loadDocument`) to pass `{ formatter }`.
   - Wired `Events.On('bib:changed', ...)` and `Events.On('menu:insert-citation', ...)` in `onMount`.
   - Added the `Cite` toolbar button after Save.

3. **`frontend/public/style.css`** — added `.cite-error`, `.preview-pane .csl-bib-body`, `.preview-pane .csl-entry`, and added `.csl-entry` to the print stylesheet's `break-inside: avoid` list.

## Deviation from the brief (found during self-review, fixed)

The brief's literal code for the reload effect reads `fm.bibliography` / `fm.csl` directly off the `$derived(parseFrontmatter(content))` object:

```ts
$effect(() => {
  void fm.bibliography
  void fm.csl
  void path
  void reloadBibliography()
})
```

I verified in Svelte 5's source (`node_modules/svelte/src/internal/client/reactivity/deriveds.js:308`, `equality.js`) that plain `$derived` always uses `safe_equals` → `safe_not_equal`, which unconditionally treats **any object return value as changed** on recomputation — regardless of reference or structural equality. Since `parseFrontmatter` returns a fresh object literal on every call, `fm` is marked "changed" on **every keystroke** (`content` changes synchronously in `onEditorChange`, not on the debounced path). That means the reload effect — and therefore `reloadBibliography()`, including the `ReadBibliography` IPC call and (for any doc with `bibliography:` set) a **new `formatter` object assigned every keystroke** — would fire on every character typed in any document that uses citations. Because `formatter` is plain `$state` (identity-equals), a new object every keystroke would also cascade into the "re-render on formatter change" effect, defeating the debounced typing path the brief's `untrack` pattern is explicitly meant to protect — for exactly the case (documents actually using citations) this feature exists for.

Fix: derive the primitive fields separately so their own equality check (plain `!==`, since `$derived`'s `safe_not_equal` reduces to strict inequality for non-object values) gates correctly:

```ts
const fm = $derived(parseFrontmatter(content))
const fmBibliography = $derived(fm.bibliography)
const fmCsl = $derived(fm.csl)
```

`reloadBibliography()` and the reload effect now reference `fmBibliography`/`fmCsl` instead of `fm.bibliography`/`fm.csl`. This is a minimal, semantically-equivalent change (same triggers: bibliography value change, csl value change, path change) that removes the per-keystroke IPC/re-render churn. Confirmed via direct read of the Svelte source rather than assumption.

No other deviations. All binding signatures (`ReadBibliography(path, docPath)`, `WatchBibliography(path, docPath)`, `PickCitations()`) matched `frontend/bindings/hermes/documentservice.ts` exactly as the brief assumed. `menu:insert-citation` and its `shift+cmdorctrl+c` accelerator were already wired on the Go side in `menu.go` (pre-existing, not part of this task) — confirmed by reading `menu.go`.

## Gate results

- `cd frontend && npm test` → 6 test files, 63 tests passed (unchanged count; no new tests added by this task, per brief).
- `cd frontend && npm run check` → `514 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `go build -o /dev/null .` → exit 0 (only pre-existing linker `ld: warning` noise about macOS version mismatch, unrelated to this change).
- `wails3 build` → succeeded (`✓ built in ...`, Go native build completed). Did not launch the GUI.

All four gates run twice: once after the initial brief-literal implementation, once after the reload-effect fix, both green.

## Files changed

- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/frontend/src/Editor.svelte`
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/frontend/src/App.svelte`
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/frontend/public/style.css`

## Self-review checklist

- **Typing hot path still debounced?** Yes. `onEditorChange` sets `content` synchronously and calls the debounced `updatePreview`. The formatter-change effect reads `content` via `untrack`, so `content` changes alone never trigger it. After the fix above, `formatter` itself is also no longer reassigned on every keystroke (only on genuine bibliography/csl/path changes), so the whole chain stays off the per-keystroke path.
- **Bib reload triggers:** document load (`path` changes) → yes; frontmatter `bibliography`/`csl` change → yes (via `fmBibliography`/`fmCsl`); `bib:changed` event → yes (`Events.On('bib:changed', () => void reloadBibliography())`). Watch stopped when doc has no bibliography: yes — `reloadBibliography()`'s early-return branch calls `DocumentService.WatchBibliography('', path ?? '')`, and per the binding's doc comment an empty path stops the watcher.
- **Cite button + menu event + ⌘⇧C all reach `insertCitation`:** yes — toolbar button calls it directly; `Events.On('menu:insert-citation', ...)` calls it; Go's `menu.go` already emits `menu:insert-citation` on `shift+cmdorctrl+c` (pre-existing, verified by reading the file). `insertAtCursor` calls `view.focus()` after dispatching, so the editor is refocused.
- **All gates green:** yes, both before and after the fix.

## Concerns

None outstanding. The one substantive concern (per-keystroke bib reload defeating the debounce) was found and fixed during self-review, with the root cause verified directly against Svelte's internal source rather than assumed.

## Fix report (post-review)

Reviewer finding: `reloadBibliography` (App.svelte) had no request sequencing. If the effect fired again before an in-flight `ReadBibliography` resolved (e.g. rapid frontmatter edits, back-to-back `bib:changed` events), a stale resolution landing last could leave `formatter`/toasts reflecting a superseded request instead of the latest one.

Fix applied in `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/frontend/src/App.svelte`:

- Added a module-scope-style generation counter, `let reloadGeneration = 0`, declared alongside the other script-level state (replacing the now-removed `bibPath` state, which the reviewer confirmed was dead — never read anywhere, an artifact of the brief's sample code).
- `reloadBibliography` now captures `const gen = ++reloadGeneration` at the top of the function.
- After the single `await DocumentService.ReadBibliography(...)`, added `if (gen !== reloadGeneration) return` before touching `parseBib`/toasts/`formatter` — a stale resolution silently discards instead of overwriting newer state.
- Added the same guard at the top of the `catch` block, before its `formatter = undefined` / toast, so a stale rejection can't clobber a newer in-flight (or already-resolved) request's state either.
- The trailing `void DocumentService.WatchBibliography(wanted, path)` call is only reached when neither guard fired, so a stale call never re-arms the watcher for a superseded path either.
- The early-return branch (`!wanted || !path`) is synchronous — no await precedes it — so no additional guard was needed there; it still correctly stops the watcher (`WatchBibliography('', path ?? '')`).
- Removed `bibPath` entirely (state declaration and the `bibPath = wanted` assignment inside `reloadBibliography`). Confirmed via `grep -n "bibPath" frontend/src/App.svelte` that no references remain.

### Gates (post-fix)

- `cd frontend && npm test` → 6 test files, 63 tests passed.
- `cd frontend && npm run check` → `514 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.

Both green; per the coordinator's covering-gate instruction, `go build`/`wails3 build` were not required to be re-run for this fix (frontend-only change, no binding/Go changes), but were already verified green after the prior implementation pass.

### Commit

`45cb992` — fix: sequence bibliography reloads so stale responses can't win
