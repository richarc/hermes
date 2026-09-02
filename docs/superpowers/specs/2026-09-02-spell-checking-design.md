# Spell Checking — Design

Source: the Spell checking item under v0.10.0 in `ROADMAP.md`, rewritten on
2026-09-02 with the investigation's findings. This document fixes the shape
of the smallest honest version and is what the implementation plan argues
from.

## What it is

macOS's own spell checker, applied to the prose of the document and to
nothing else. Misspelled words get the native red underline as you type, and
the native right-click menu offers corrections. A View → Check Spelling
checkbox turns it off and on.

Not in scope: a whole-document pass (WebKit only checks as you type and the
word the caret leaves), the Spelling and Grammar submenu (needs cgo to send
AppKit selectors; a follow-up), grammar checking, a bundled dictionary.

## What is checked and what is not

The editor's content element gets `spellcheck="true"`. Inside it, these
regions are wrapped in spans carrying `spellcheck="false"`, which WebKit
honours per element (`Element::isSpellCheckingEnabled` returns at the
nearest ancestor with the attribute):

- Fenced code and indented code blocks (`FencedCode`, `CodeBlock`), and
  inline code (`InlineCode`), from the syntax tree.
- Frontmatter, by line: a leading `---` line closed by a later `---` line,
  the same rule `isProtected` uses.
- Link destinations (`URL` nodes) and autolinks; link *text* stays checked.
- HTML blocks and inline HTML tags (`HTMLBlock`, `HTMLTag`).
- Maths, by pattern, since the editor's grammar has no maths node: a
  display block opens with `$$` at the start of a line and closes at the
  next `$$` (the preview's blockMath closes on a line ending with or
  containing `$$`, and treats `$$x$$` on one line as a block); inline
  `$…$` spans whose delimiters are not adjacent to a word character or
  digit and whose opener is not backslash-escaped; and bare
  `\begin{name}…\end{name}` environments, which the preview also renders
  as maths.
- Citations, by pattern: `[@key]`, `[@key, p. 3; @other]` bracket groups
  and bare `@key` tokens.

`autocorrect`, `autocapitalize` and `writingsuggestions` stay at the
CodeMirror defaults (off). Auto-correction would rewrite words in place,
which is wrong for a source editor.

## Setting and menu

`SpellCheck bool` (`spellCheck`) in `Settings`, default **true**. View →
Check Spelling, a checkbox below Autosave, no accelerator.

The frontend passes the setting to the editor as a prop; the editor holds
the spellcheck extension in a `Compartment` and reconfigures on change. Off
means the CodeMirror default: `spellcheck="false"` on the content element
and no decorations.

## WebKit's default

WebKit reads `WebContinuousSpellCheckingEnabled` from the app's
`NSUserDefaults` with no registered default, so a `WKWebView` app has
continuous checking **off** until the key is set. Hermes registers the key
as true (`registerDefaults`) before the window is created, in a
darwin-only cgo file with a no-op stub elsewhere, the `print_darwin.go`
pattern. Registered defaults are not persisted, so this is safe to run on
every launch, and a value the user later sets through any future Spelling
menu wins.

## Files

- `frontend/src/lib/spellcheck.ts`: `protectedRanges(state, from, to)`, a
  pure function returning sorted, non-overlapping ranges to exclude within
  `[from, to)`, and `spellcheckExtension()`: the content attribute plus a
  `ViewPlugin` that decorates the visible ranges.
- `frontend/src/Editor.svelte`: a `spellcheck` prop and a `Compartment`.
- `frontend/src/App.svelte`: `spellCheck` from settings, passed to the
  editor.
- `settings.go`, `menu.go`: the field and the checkbox.
- `spellcheck_darwin.go`, `spellcheck_other.go`: `registerSpellCheckingDefaults()`.
- `main.go`: calls it first.

## Docs

README: a sentence in "Your first document" and a Known limitations entry
about coverage. CHANGELOG entry. CLAUDE.md bullet. ROADMAP item ticked.
