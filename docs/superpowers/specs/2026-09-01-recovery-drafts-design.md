# Recovery Drafts — Design

Source: the Autosave item in `ROADMAP.md` (noted 2026-08-30). This document
fixes the decisions that item left open and is what the implementation plan
argues from.

## What it is

Explicit Save stays the act of record. The document on disk changes only on
⌘S, Save As…, or the Save button of the unsaved-changes dialog. Autosave is
crash insurance: while a document is dirty, Hermes writes a *recovery draft*
beside its settings file, and offers it back the next time that document is
opened if the file on disk has not caught up with it.

Not in scope: writing the document itself on a timer (the macOS model),
noticing an external edit at ⌘S time, and versions/history.

## Where drafts live

`<xdg data>/hermes/drafts/<key>.json`, beside `recents.json` and
`settings.json`. `<key>` is `untitled` for a document with no path, otherwise
the first 16 hex characters of the SHA-256 of the document's absolute path.
The file is JSON `{"path": "...", "content": "..."}`; the path is stored for
debugging and pruning, the key is what is looked up. Written with
`writeFileAtomic`, mode 0600.

One draft per document path. A draft is never written over the document.

## When a draft is written

- Only while the document is dirty (`content !== savedContent`) and the
  `autoSave` setting is on.
- Debounced 2 s after the last change, with the same `debounce` helper the
  preview uses. An idle document is never written. There is no fixed
  interval and no maximum-wait floor; a continuous burst of typing with no
  2 s pause defers the write, which is accepted for now.

## When a draft is removed

- When the document goes from dirty to clean: a successful Save or Save As…,
  "Don't Save" in the unsaved-changes dialog, or typing back to the saved
  text. The discard is queued *after* any draft write still in flight, so a
  slow write cannot resurrect a draft the discard was meant to remove.
- Before quitting, the frontend waits for that queue to drain, so a draft is
  not left behind by a Save-then-quit.
- On open, when the store decides the draft is superseded (below).
- At launch, any draft file older than 30 days is deleted. Renamed or
  deleted documents leave drafts keyed by a path that no longer exists;
  this is how they go away.

Turning the setting off stops new writes. An existing draft stays until the
document next goes clean or is opened, so switching the setting off does not
throw away insurance already written.

## When a draft is offered back

On opening a document (Open…, Open Recent, the welcome pane), and once at
launch for the `untitled` key.

The Go side decides whether the draft is worth offering. `RecoverDraft(path)`
returns *not found* and deletes the draft when any of these hold:

- there is no draft file, or it cannot be parsed, or its content is empty;
- the document's mtime is at or after the draft's mtime (the file was saved
  or edited after the draft was written);
- the document's content equals the draft's content.

If the document cannot be read (deleted since), the draft is offered anyway;
it is all there is.

The frontend shows a `Dialog` (role `alertdialog`, label "Recover draft"):

> A draft of "paper.md" newer than the file on disk was found. Restore it?

or, for the untitled draft:

> An unsaved untitled document was recovered from the last session. Restore it?

Buttons: **Discard Draft**, **Restore** (primary, default).

- Restore: the draft's text replaces the editor content; `savedContent`
  stays as the file's content (empty for untitled), so the document is
  dirty and the status bar shows it. The draft file stays until the next
  clean transition.
- Discard Draft: `DiscardDraft(path)` and the file's content stays.

The dialog is not raised while the chart or table builder is open; opening
a document is already refused in that state, so no new guard is needed.

## Setting and menu

`AutoSave bool` (`autoSave`) in `Settings`, default **true**, toggled by a
View → Autosave checkbox below View → Outline. No accelerator.

Because `Settings` is unmarshalled into a zero value today, a missing bool
key reads as `false`. That would turn autosave off for every existing
install. The loader now unmarshals over `defaultSettings()` so an absent key
takes the default, which is the behaviour the doc comment on `Settings`
already claims.

## Failure handling

A failed draft write is reported once per document by toast ("Could not
write a recovery draft: …") and not again until the document changes. A
failed discard or recover is logged to the console and ignored; a stale
draft costs the user one extra dialog at worst.

## Bindings

Three new `DocumentService` methods, so `frontend/bindings/` must be
regenerated with `wails3 task common:generate:bindings`:

```go
func (s *DocumentService) WriteDraft(docPath, content string) error
func (s *DocumentService) DiscardDraft(docPath string) error
func (s *DocumentService) RecoverDraft(docPath string) (Draft, error)

type Draft struct {
    Found   bool   `json:"found"`
    Content string `json:"content"`
}
```
