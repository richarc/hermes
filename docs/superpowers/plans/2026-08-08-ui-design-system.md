# Consistent UI Elements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hermes' chrome one vocabulary — a styled button in three kinds, real interaction states, app-wide form controls, and a single dialog shell built on the native `<dialog>` element.

**Architecture:** Two new palette tokens, then element-level CSS replacing per-context rules, then one `Dialog.svelte` that both modals use. No Button or Field component: fourteen call sites styled by an element selector is less machinery than fourteen imports, and only the dialog carries behaviour worth encapsulating.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest 4, jsdom 30.

## Source design

`docs/superpowers/specs/2026-08-08-ui-design-system-design.md` (commit `497098c`). Read it first — three of its findings are the reason this plan is shaped the way it is.

## Global Constraints

- Branch off `main`, which is at `497098c`. Commit there.
- `frontend/public/style.css` is governed by two test files and both are strict:
  - `styleContract.test.ts` — **no literal colours in any rule**, only `var(--name)`; the `:root`, `:root[data-theme="dark"]` and `@media print`'s `:root, :root[data-theme="dark"]` blocks must declare **exactly the same variable names**.
  - `contrast.test.ts` — every pair in its `PAIRS` list must meet its WCAG target in the light and dark blocks (print is not checked).
- New token values: `--accent` `#0b57c2` light / `#7cb0ff` dark / `#0b62d6` print; `--on-accent` `#ffffff` light / `#12233d` dark / `#ffffff` print.
- Primary styling belongs to **dialog confirm actions only**. The toolbar's five buttons are peers.
- **`App.svelte`'s `if (chartOpen) return` guards all stay.** They intercept menu events arriving from AppKit through Go's event bus, which never touch the DOM, so a focus trap cannot replace them. Removing one reintroduces the bug it was written for.
- **jsdom 30 implements `<dialog>` as an element but not `showModal`/`close`** — verified against the installed version. The component must feature-detect and fall back to the `open` attribute, or every test that mounts a dialog throws.
- Style idiom: no semicolons, single quotes, 2-space indent, comments explaining *why*. `style.css` uses compact one-line rules for short declarations.
- Tests: `(cd frontend && npx vitest run)`; type check `(cd frontend && npm run check)`; Go `go test ./.` (single dot).

---

### Task 1: The accent tokens

**Files:**
- Modify: `frontend/public/style.css` — three palette blocks
- Test: `frontend/src/lib/contrast.test.ts` (one line)

**Interfaces:**
- Consumes: nothing.
- Produces: `--accent` and `--on-accent`, available to every later task. Nothing references them yet, which is fine — `styleContract.test.ts` checks that referenced variables are defined, not that defined ones are referenced.

- [ ] **Step 1: Write the failing test**

In `frontend/src/lib/contrast.test.ts`, add one entry to the `PAIRS` array, after the `['link', '--link', '--bg', 4.5]` line:

```ts
  ['primary button', '--on-accent', '--accent', 4.5],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/contrast.test.ts)`
Expected: FAIL in both the light and dark cases. `palette()` returns no `--accent`, so `contrast()` receives `undefined`, `relativeLuminance` parses it as `NaN`, and the comparison fails — the message will be a `NaN:1` ratio or a thrown parse error rather than a clean assertion. Either is the expected RED here; note which you saw.

- [ ] **Step 3: Add the tokens**

In `frontend/public/style.css`, in the light `:root` block, immediately after the `--link: #0b57c2;` line:

```css
  /* Filled primary button. Valued as the link colour, but named for its role:
     a rule reading `background: var(--link)` on a button would be a lie about
     intent every future reader has to see through. */
  --accent: #0b57c2;
  --on-accent: #ffffff;
```

In the `:root[data-theme="dark"]` block, after `--link: #7cb0ff;`:

```css
  --accent: #7cb0ff;
  --on-accent: #12233d;
```

In the `@media print` block's `:root, :root[data-theme="dark"]`, after `--link: #0b62d6;`:

```css
    --accent: #0b62d6;
    --on-accent: #ffffff;
```

(Note the print block is indented four spaces, not two.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run src/lib/contrast.test.ts src/lib/styleContract.test.ts)`
Expected: PASS. The contrast pair resolves to 6.65:1 light and 7.13:1 dark; the three-block parity checks in `styleContract.test.ts` still pass because both names were added to all three.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/style.css frontend/src/lib/contrast.test.ts
git commit -m "feat: add accent tokens for a filled primary button"
```

---

### Task 2: Buttons, states and form controls

**Files:**
- Modify: `frontend/public/style.css` — replace the welcome-button rules, add a control block, promote `.encode-step` selectors
- Modify: `frontend/src/App.svelte` — recents button, welcome actions, the confirm dialog's Save
- Modify: `frontend/src/ChartBuilder.svelte` — the commit button
- Test: `frontend/src/lib/styleContract.test.ts` (append)

**Interfaces:**
- Consumes: `--accent`, `--on-accent` from Task 1.
- Produces: a `button` element style, `.primary`, `.link-button`, and element-level `input`/`select`/`textarea` styling. Task 3 relies on `.modal-buttons` still existing as the footer row class.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/styleContract.test.ts`:

```ts
describe('control styling', () => {
  const css = stripComments(CSS)

  it('gives every button a focus-visible ring, not just the browser default', () => {
    // Styling a control removes the UA ring. Losing it is invisible in every
    // automated check and obvious only to someone navigating by keyboard.
    expect(css).toMatch(/button:focus-visible[^{]*\{[^}]*outline:/)
  })

  it('gives the pane divider a focus ring too', () => {
    // .divider carries tabindex="0" for the WAI-ARIA splitter pattern, so it
    // is a focus stop that is not a control and would otherwise be missed.
    expect(css).toMatch(/\.divider:focus-visible[^{]*\{[^}]*outline:/)
  })

  it('styles disabled buttons', () => {
    expect(css).toMatch(/button:disabled[^{]*\{/)
  })

  it('no longer carries the one-off welcome button rule', () => {
    // Promoted to the base button style; a survivor would silently win on
    // specificity and keep the welcome pane looking different from the rest.
    expect(css).not.toContain('welcome-action')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/styleContract.test.ts)`
Expected: FAIL on all four — there is no `:focus-visible`, no `:disabled` rule anywhere in the file, and `welcome-action` is still present.

- [ ] **Step 3: Write the CSS**

In `frontend/public/style.css`, replace these two rules:

```css
.welcome button { display: block; padding: 6px 0; }
.welcome-actions { display: flex; gap: 12px; margin-top: 24px; }
.welcome-actions button.welcome-action {
  display: inline-block; padding: 8px 16px;
  border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface);
  color: var(--fg);
}
```

with:

```css
.welcome-actions { display: flex; gap: 12px; margin-top: 24px; }
```

Then add this block immediately after the `.toolbar button { -webkit-app-region: no-drag; }` line:

```css
/* Controls. One vocabulary for every button and field in the chrome — the
   preview pane renders markdown with html:false and emits none of these, so
   element selectors are safe here.

   Reach worth knowing: CodeMirror's find/replace panel (⌘F, from basicSetup's
   searchKeymap) renders real <input> and <button> elements, so these rules
   restyle it too. That is the intended gain, not an accident. */
button {
  font: inherit;
  font-size: 13px;
  padding: 5px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  cursor: pointer;
}
button:hover { border-color: var(--fg); }

/* The default action of a dialog — what Return does. Deliberately not used in
   the toolbar, where the five actions are peers and promoting one would claim
   something about the user's intent that Hermes cannot know. */
button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 500;
}
/* brightness() rather than an --accent-hover token: it reads as a darker blue
   in light and a dimmer one in dark, and keeps --on-accent above 4.5:1 in
   both, where a second token would need a value in three palette blocks and
   its own contrast pair to say the same thing. */
button.primary:hover { filter: brightness(0.92); border-color: var(--accent); }

/* A button that is really a link — the welcome pane's recent files are a
   column of paths, and bordered boxes would read worse than what is there
   today. */
button.link-button {
  display: block;
  padding: 6px 0;
  border: 1px solid transparent;
  border-radius: 0;
  background: none;
  color: var(--fg);
  text-align: left;
}
button.link-button:hover { border-color: transparent; text-decoration: underline; }

/* Opacity drops the filled button under 4.5:1. That is permitted — WCAG 1.4.3
   exempts inactive controls — and is noted here so it does not read as a bug. */
button:disabled { opacity: 0.45; cursor: default; }
button:disabled:hover { border-color: var(--border-strong); filter: none; }

input, select, textarea {
  font: inherit;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 14px;
}

/* Styling a control removes the browser's focus ring, so it is put back
   explicitly — including on .divider, which is tabindex="0" for the WAI-ARIA
   window-splitter pattern and is a focus stop without being a control. */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
.divider:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Finally, reduce the now-duplicated `.encode-step` rule to the layout it still owns — replace:

```css
.encode-step select,
.encode-step input {
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 14px;
}
```

with nothing. The element rule above covers it.

- [ ] **Step 4: Update the markup**

In `frontend/src/App.svelte`, the recents list button (inside the `{#each recents}`):

```svelte
          <li><button class="link-button" onclick={() => requestOpenRecent(r)}>{r}</button></li>
```

The two welcome actions lose their now-deleted class:

```svelte
        <button onclick={requestNew}>New document</button>
        <button onclick={requestOpen}>Open…</button>
```

The confirm dialog's Save becomes the primary:

```svelte
          <button class="primary" onclick={() => void confirmSave()}>Save</button>
```

In `frontend/src/ChartBuilder.svelte`, the commit button:

```svelte
      <button class="primary" disabled={!ready} onclick={commit}>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite. Watch `App.test.ts`'s `buttonByText` helper, which matches on `textContent` and is unaffected by classes, and `ChartBuilder.test.ts`'s Insert/Update-chart lookups, which do the same. `contrast.test.ts` and the rest of `styleContract.test.ts` must still pass — the new rules introduce no literal colours.

- [ ] **Step 6: Commit**

```bash
git add frontend/public/style.css frontend/src/App.svelte frontend/src/ChartBuilder.svelte frontend/src/lib/styleContract.test.ts
git commit -m "feat: give buttons and form controls one vocabulary"
```

---

### Task 3: One dialog shell

**Files:**
- Create: `frontend/src/Dialog.svelte`
- Create: `frontend/src/Dialog.test.ts`
- Modify: `frontend/src/App.svelte` — the unsaved-changes dialog
- Modify: `frontend/src/ChartBuilder.svelte` — its own wrapper
- Modify: `frontend/public/style.css` — replace `.modal-backdrop`/`.modal`/`.chart-builder` sizing

**Interfaces:**
- Consumes: the `.primary` class and control styling from Task 2.
- Produces: `Dialog.svelte` with props `{ open: boolean, label: string, onclose: () => void, class?: string, children: Snippet, footer?: Snippet }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/Dialog.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { createRawSnippet } from 'svelte'
import Dialog from './Dialog.svelte'

const body = createRawSnippet(() => ({ render: () => '<p>Body text</p>' }))

function mountDialog(open: boolean, onclose = vi.fn()) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(Dialog, {
    target,
    props: { open, label: 'Test dialog', onclose, children: body },
  })
  flushSync()
  return {
    target,
    onclose,
    el: target.querySelector('dialog')!,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('Dialog', () => {
  it('mounts without throwing where showModal is absent', () => {
    // jsdom 30 implements <dialog> as an element but not showModal/close. An
    // unguarded call throws and takes out every suite that mounts a dialog,
    // so this is the test that protects ChartBuilder.test.ts and App.test.ts.
    expect(typeof (document.createElement('dialog') as HTMLDialogElement).showModal).toBe(
      'undefined',
    )
    const d = mountDialog(true)
    expect(d.el.open).toBe(true)
    d.cleanup()
  })

  it('renders its content', () => {
    const d = mountDialog(true)
    expect(d.el.textContent).toContain('Body text')
    d.cleanup()
  })

  it('is closed when open is false', () => {
    const d = mountDialog(false)
    expect(d.el.open).toBe(false)
    d.cleanup()
  })

  it('carries its accessible name', () => {
    const d = mountDialog(true)
    expect(d.el.getAttribute('aria-label')).toBe('Test dialog')
    d.cleanup()
  })

  it('asks the parent to close on Esc rather than closing itself', () => {
    // The parent owns `open`, so the dialog reports the intent instead of
    // acting on it — otherwise the element and the prop drift apart.
    const d = mountDialog(true)
    d.el.dispatchEvent(new Event('cancel', { cancelable: true }))
    flushSync()
    expect(d.onclose).toHaveBeenCalledTimes(1)
    expect(d.el.open).toBe(true)
    d.cleanup()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/Dialog.test.ts)`
Expected: FAIL — `Failed to resolve import "./Dialog.svelte"`.

- [ ] **Step 3: Write the component**

Create `frontend/src/Dialog.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    /** Accessible name; the dialogs here have no visible title element. */
    label: string
    /** The dialog asks to close; the parent owns `open` and decides. */
    onclose: () => void
    /** Extra classes, for a call site that needs its own sizing. */
    class?: string
    children: Snippet
    footer?: Snippet
  }

  const { open, label, onclose, class: extra = '', children, footer }: Props = $props()

  let el: HTMLDialogElement | undefined = $state()

  // jsdom 30 implements <dialog> as an element but leaves showModal and close
  // undefined, so calling one throws and takes out every test that mounts a
  // dialog. Reflecting the `open` attribute is what jsdom does support, and is
  // enough for the component to render there. Same shape, and the same
  // reasoning, as Preview.svelte's `typeof ResizeObserver === 'undefined'`
  // guard: load-bearing for tests, not defensive.
  //
  // What is lost under the fallback is real: the focus trap, Esc, inertness
  // and top-layer rendering are browser behaviours, so they are manual checks
  // rather than assertions.
  $effect(() => {
    const d = el
    if (!d) return
    if (open) {
      if (typeof d.showModal === 'function') {
        if (!d.open) d.showModal()
      } else {
        d.open = true
      }
    } else if (typeof d.close === 'function') {
      if (d.open) d.close()
    } else {
      d.open = false
    }
  })

  // Esc fires `cancel`. Prevented, so the element does not close behind the
  // parent's back and leave `open` describing something untrue.
  function onCancel(event: Event) {
    event.preventDefault()
    onclose()
  }
</script>

<dialog bind:this={el} class={extra} aria-label={label} oncancel={onCancel}>
  <div class="dialog-body">{@render children()}</div>
  {#if footer}
    <div class="modal-buttons">{@render footer()}</div>
  {/if}
</dialog>
```

- [ ] **Step 4: Replace the dialog CSS**

In `frontend/public/style.css`, replace:

```css
.modal-backdrop {
  position: fixed; inset: 0; background: var(--backdrop);
  display: grid; place-items: center;
}
.modal { background: var(--overlay-bg); border-radius: 8px; padding: 24px; max-width: 400px; }
.modal-buttons { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
```

with:

```css
/* The native element handles centring, the top layer and the backdrop, so the
   old .modal-backdrop wrapper is gone. Padding lives on .dialog-body rather
   than the dialog, so the sticky footer can sit flush against the edge. */
dialog {
  background: var(--overlay-bg);
  color: var(--fg);
  border: none;
  border-radius: 8px;
  padding: 0;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
}
dialog::backdrop { background: var(--backdrop); }
.dialog-body { padding: 24px; }

/* Sticky, so a large pasted table cannot scroll the Insert button out of
   sight. The background is the dialog's own, or the content shows through. */
.modal-buttons {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 24px;
  background: var(--overlay-bg);
  border-top: 1px solid var(--border);
}
```

and reduce `.chart-builder` to the sizing it still owns:

```css
.chart-builder {
  width: min(56rem, 90vw);
  max-width: min(56rem, 90vw);
  text-align: left;
}
```

- [ ] **Step 5: Migrate both call sites**

In `frontend/src/App.svelte`, add the import beside the others:

```ts
  import Dialog from './Dialog.svelte'
```

and replace the whole `{#if pendingAction}` block:

```svelte
  <Dialog
    open={pendingAction !== null}
    label="Unsaved changes"
    onclose={() => {
      pendingAction = null
      pendingRecentPath = null
    }}
  >
    <p>"{filename}" has unsaved changes.</p>
    {#snippet footer()}
      <button onclick={() => void confirmSave()}>Save</button>
      <button onclick={() => void confirmDiscard()}>Don't Save</button>
      <button
        onclick={() => {
          pendingAction = null
          pendingRecentPath = null
        }}>Cancel</button
      >
    {/snippet}
  </Dialog>
```

Note the button order changed: the primary moves to the end, where a macOS dialog puts its default action. Mark Save `class="primary"` if Task 2 left it unmarked after the restructure.

In `frontend/src/ChartBuilder.svelte`, add the import and replace the outer two wrapper divs. The opening becomes:

```svelte
<Dialog open label="Chart builder" class="chart-builder" onclose={oncancel}>
```

with the existing `<h2>Chart</h2>` and sections as its children, and the existing `.modal-buttons` div becoming the `footer` snippet:

```svelte
  {#snippet footer()}
    <button onclick={oncancel}>Cancel</button>
    <button class="primary" disabled={!ready} onclick={commit}>
      {initial ? 'Update chart' : 'Insert chart'}
    </button>
  {/snippet}
```

`open` is a bare attribute because `App.svelte` only renders `ChartBuilder` while `chartOpen` is true.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite. The suites most at risk are `ChartBuilder.test.ts`, which mounts the builder and queries `textarea` and buttons by text, and `App.test.ts`'s unsaved-changes tests, which use `buttonByText`. Both query the document, and the fallback leaves the dialog's children in the DOM, so they should pass unchanged — if one does not, report what it asserts before changing it.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Dialog.svelte frontend/src/Dialog.test.ts frontend/src/App.svelte frontend/src/ChartBuilder.svelte frontend/public/style.css
git commit -m "feat: build both modals on one native dialog shell"
```

---

### Task 4: Changelog and verification

**Files:**
- Modify: `CHANGELOG.md` — a new bullet under `## [Unreleased]` → `### Added`

- [ ] **Step 1: Run the full verification suite**

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
```

Expected: all green. `go build` emits pre-existing macOS linker version warnings on this machine; any other noise is a finding. Do not proceed on a failure.

- [ ] **Step 2: Write the changelog entry**

Add under `## [Unreleased]` → `### Added`, after the last existing bullet:

```markdown
- A consistent look for the app's own controls. Every button now has real
  padding, a border, and hover, focus and disabled states — previously only
  the two welcome-pane buttons were styled at all. A dialog's confirming
  action is filled, so it is clear what Return does. Both dialogs are now
  built on one shell using the native `<dialog>` element, which keeps Tab
  inside them, closes on Esc, and keeps a large chart's Insert button visible
  instead of scrolling it away. Keyboard focus is visible everywhere it lands,
  including the pane divider.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: record the control and dialog restyle"
```

- [ ] **Step 4: Hand over the manual check**

Reproduce this list in the report as NOT DONE, for a human. jsdom has no layout engine and no top layer, so none of it can be asserted.

1. Every button in the toolbar, both dialogs and the welcome pane has padding, a border and a hover state, in light and dark.
2. Tab through the toolbar and the pane divider: every stop shows a focus ring, the divider included.
3. Open the chart builder with a large pasted table: Insert chart stays visible while the body scrolls.
4. With the builder open, Tab repeatedly — focus stays inside — and press Esc — it closes without committing.
5. With the builder open, use a menu accelerator (⌘B, ⌘N): still refused. The guards are unchanged and must remain effective.
6. Confirm the dialog backdrop actually dims the app. `::backdrop` reads custom properties only in recent WebKit; if it renders transparent, that is the cause.
7. ⌘F in the editor: the find panel's input and buttons now match the app.
8. The welcome pane's recent files still read as a list of paths, not a stack of boxes.
9. Export a PDF: chrome is hidden as before, and no accent colour appears.

---

## Self-Review

**Spec coverage.** Tokens and the contrast pair → Task 1. The three button kinds, all four states, the divider focus ring and app-wide form controls → Task 2. The dialog shell, the jsdom fallback, the sticky footer and the collapse of `.modal-backdrop`/`.modal` → Task 3. The design's "what this does not fix" — the `chartOpen` guards — is carried into the Global Constraints and into manual check 5, so a reviewer can catch an implementer who tidies one away.

**Placeholder scan.** Every code step carries the actual code; every test step the actual assertions.

**Type consistency.** `Dialog`'s props are declared once in Task 3 and used at both call sites in the same task. `class` is received as `class: extra` because `class` is reserved. `.modal-buttons` survives as the footer row class, which is why Task 2 must not delete it.

**One thing a reviewer should watch.** Task 1's RED is untidy: a missing `--accent` reaches `relativeLuminance` as `undefined` and produces a `NaN` ratio or a parse throw rather than a clean assertion failure. That is expected. If it fails some other way, the palette block was edited before the test.
