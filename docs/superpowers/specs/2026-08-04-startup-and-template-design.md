# Hermes v0.4 — Startup Route and New-Document Template: Design

**Date:** 2026-08-04
**Status:** Approved design, pending implementation plan

## Overview

Two v0.4 roadmap items, designed together because they collide at exactly one
point — what a first launch shows:

1. **A reachable Open.** There is currently no discoverable way to open a
   document that is not already in the recents list.
2. **New documents start from a template.** A frontmatter block with commented
   guidance, so the bibliography feature is discoverable without reading the
   README.

Both are about how a user gets *into* a document, which is why they share a
spec. Neither changes anything once a document is open.

## Problem 1: the unreachable Open button

`.welcome` is an opaque full-window overlay (`position: absolute; inset: 0`),
so it covers the toolbar — including the Open button that already exists. The
only remaining route to an arbitrary file is File → Open… (⌘O), which is
installed at startup but invisible from that screen. A user who has never
opened a file, or who wants one not in their recents, has nothing to click.

### Options considered

| Option | Verdict |
|---|---|
| **A — Give the welcome pane its own `Open…` button** | **Chosen** |
| B — Drop the welcome pane below the toolbar so the existing button shows | Rejected |
| C — Both | Rejected: two routes to one action from one screen |

B looks cheaper — one CSS change instead of a new button — but it exposes
Save, Cite, and Export PDF at a moment when no document exists. All three would
be live and inert, so B quietly implies disabling them too, and it turns a
focused start screen into a half-functional editor chrome. A keeps the welcome
pane a self-contained mode that carries its own actions.

## Problem 2: the template

### Content

```
---
# To cite: put a .bib file beside this document, name
# it below, then write [@key] in your text. Styles:
# apa, chicago-author-date, ieee, vancouver, harvard.
# bibliography: references.bib
# csl: apa
---
```

Three properties this shape is chosen for:

**The keys are commented, not live.** A live `bibliography: references.bib`
pointing at a file that does not exist would fire the "Bibliography not found"
toast on every single new document. Commented lines are inert for free:
`parseFrontmatter` only matches `/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/`, and `#`
is not `[A-Za-z]`.

**Guidance lives in YAML `#` comments inside the fences, not HTML comments.**
The renderer runs markdown-it with `html: false`, so `<!-- … -->` would be
escaped and appear as literal text in the preview. The frontmatter block is
stripped wholesale instead, so the preview stays empty.

**It names all five styles.** The style ids are otherwise documented only in
the README, and a user who does not know them cannot use `csl:` at all. This is
the discoverability the item is actually for.

It is one contiguous block, so a user who does not want citations selects the
seven lines and deletes them in one motion. A body stub was considered and
rejected: it costs that property, and its sample `[@key]` would render as a red
unresolved-citation error until a `.bib` is wired up.

The template ends with a single newline after the closing `---`, so with the
cursor at end-of-document the user starts typing on the empty line directly
below the frontmatter. `parseFrontmatter`'s closing fence accepts a trailing
newline or EOF, so the parsed body is `''` either way.

### Not born dirty

`dirty` is derived as `content !== savedContent`. Seeding only `content` would
make every new document dirty on creation and prompt on close despite the user
never touching it. `doNew()` seeds **both**.

## Behaviour

| Situation | Result |
|---|---|
| Launch, recents exist | Welcome pane over the toolbar, with `New document` and `Open…` |
| Launch, no recents | Templated untitled document, toolbar visible, not dirty |
| File → New (⌘N) | Templated untitled document, not dirty |
| `New document` button | Same as File → New |
| Template left untouched, then close | No save prompt |

## Startup sequencing

Whether to template at startup depends on `recents.length`, which arrives from
an async binding call. Two ways to handle that:

| Option | Verdict |
|---|---|
| **A — Await recents, then template if the list is empty** | **Chosen** |
| B — Always template at startup, let the welcome overlay hide it | Rejected |

B has no race, but `editor.setContent()` fires `onEditorChange`, which sets
`welcomeDismissed = true`. Templating at startup would therefore suppress the
welcome pane permanently, for everyone. Rescuing that means either bypassing
the change handler or resetting the flag afterwards — trading a clean invariant
(`welcomeDismissed` means "the user has engaged with a document") for a
millisecond of cosmetics.

Under A, a first launch shows an empty editor for the duration of one IPC round
trip before the template lands. There is nothing visible to flash *from*, and
it happens only when the recents list is empty.

`showWelcome` needs no change. It already requires `content === ''`, and every
templated path sets `content`, so the pane correctly stays hidden in exactly
the cases where a document exists.

## Components

**`lib/documentTemplate.ts`** (new) — exports the template string and nothing
else. Its own module so the inertness of the commented keys can be asserted
without mounting a component.

**`App.svelte`**
- `doNew()` seeds `content` and `savedContent` with the template, and renders
  the preview from it (which yields `''`, since the body is empty once the
  frontmatter is stripped).
- `onMount` awaits `refreshRecents()` and, when the list comes back empty,
  calls `doNew()` — the same path, not a second copy of the seeding logic.
  There is exactly one place that creates a templated document.
- The welcome pane gains an `Open…` button wired to the existing
  `requestOpen()`.
- The welcome pane's `New document` button changes from setting
  `welcomeDismissed = true` to calling `requestNew()`, so both routes to a new
  document produce the same one. This is a real fix, not just plumbing: today
  that button dismisses the overlay without resetting anything.

**`Editor.svelte`** — `setContent` gains an explicit cursor position at
end-of-document. It currently sets no selection at all, so the cursor lands at
offset 0 and a user typing after File → New would type *above* the frontmatter.

**`public/style.css`** — layout for a second button in the welcome pane.

No Go changes. `menu:new` already exists and the template is frontend-only.

## Decisions worth revisiting

**`setContent` moves the cursor to the end for every caller, including opening
an existing file.** Approved deliberately. The consequence is that opening a
long paper lands the cursor — and the viewport — at the bottom rather than the
top. If that reads wrong in use, the fix is to give `setContent` a cursor
argument and pass `end` from `doNew()` and `start` from `loadDocument()`; the
call sites are already distinct.

## Error handling

Nothing new can fail. The template is a compile-time constant, the commented
keys are inert, and the preview renders empty because frontmatter is stripped
before markdown-it sees it.

## Testing

**`documentTemplate.test.ts`** — `parseFrontmatter` extracts no `bibliography`
and no `csl` from the template (the property that keeps the error toast from
firing on every new document), and `render()` on it produces empty output.

**Component tests** — the first in the project, following the per-file
`// @vitest-environment jsdom` directive `charts.test.ts` already uses, which
is what review item T1 recommends:
- the welcome pane offers `Open…` when recents exist;
- `New document` yields a templated document that is not dirty;
- a first launch with no recents templates itself;
- a first launch with recents shows the welcome pane and leaves the document
  empty.
