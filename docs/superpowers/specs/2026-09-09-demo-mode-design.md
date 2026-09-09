# Demo Mode — Design

Source: a conversation on 2026-09-09 about automating screen recordings of
Hermes Editor. Three options were weighed (an AI driving the app through
screenshots and the accessibility API, scripted AppleScript/JXA automation,
and a playback mode inside Hermes); the third was chosen for repeatable demo
and guide videos. This document fixes the design that was approved in chat.

## What it is

Hermes can play a script of editing actions into itself, with realistic
typing, while recording its own window with macOS's built-in
`screencapture`. The result is an identical video on every run, with no
dependence on where a menu item sits on screen and no permission beyond
Screen Recording. It exists for demo and guide videos, not for QA.

Not in scope: driving native panels (the Zotero picker, the PDF export
panel, the open dialog), mouse movement, audio, any UI for writing or
running scripts.

## How it starts

An environment variable, `HERMES_DEMO`, holding the path of a script. Go
reads it once at launch. Nothing in the app shows it exists. A production
build honours it too: a document cannot set an environment variable, so
there is nothing to expose, and recording against the signed build is the
point.

```
HERMES_DEMO=$PWD/docs/demos/chart.demo "bin/Hermes Editor.app/Contents/MacOS/Hermes Editor"
open -n "bin/Hermes Editor.app" --env HERMES_DEMO=$PWD/docs/demos/chart.demo
```

The second form makes Hermes, not the terminal, the process macOS asks to
grant Screen Recording.

## Script format

One step per line: a verb, a space, an argument. `#` starts a comment;
blank lines are ignored. Two verbs take a body: the lines after them, up to
a line holding a single `.`, are the body, exactly as written. Paths are
relative to the script's own folder.

```
# Insert a chart into the test document.
open test-document.md
pause 1500
record chart-demo.mov
goto 41
type 45
The pattern is clearer once the counts are charted.
.
pause 600
menu insert-chart
pause 2000
chart
{"mark": "bar", "data": {"values": [{"x": "a", "y": 3}]}}
.
pause 2500
stop
```

| Verb | Argument | Body | Does |
|---|---|---|---|
| `open` | path | | Opens the document, as Open Recent would. Dismisses the welcome pane. |
| `goto` | line number | | Moves the cursor to that line, scrolling both panes. |
| `type` | cadence in ms per character, default 40 | yes | Inserts the body one character at a time at the cursor, waiting the cadence between characters. Line breaks in the body are typed as line breaks. |
| `pause` | ms | | Waits. |
| `menu` | `insert-chart`, `insert-table`, or `format <name>` | | Does what that menu item does. `<name>` is any name Format accepts (`bold`, `italic`, `heading:2`, `bullet`, …). |
| `chart` | | yes | Commits the body as a Vega-Lite spec through the chart builder's own commit, which closes the builder. The builder must be open. |
| `table` | | yes | Commits the body, a GFM pipe table, through the table builder's commit. The builder must be open. |
| `record` | path | | Starts recording the window. |
| `stop` | | | Stops the recording. Implied at the end of the script and at quit. |
| `quit` | | | Quits Hermes without saving. |

Go parses the whole script at launch and refuses to start on the first
line it cannot read, naming the line and the reason. A typo fails before
anything is recorded.

## Where the pieces live

**`demo.go`** — the parser (`parseDemoScript`), the `DemoStep` type
(`Verb`, `Arg`, `Body`), and a `DemoService` registered beside
`DocumentService` with three bindings:

- `Script()` returns the parsed steps, or nothing when `HERMES_DEMO` is
  unset. The frontend asks once it has mounted, because Go cannot know
  when the page is ready to be pushed to.
- `StartRecording(path)` runs `screencapture -v -x -R x,y,w,h <path>` for
  the window's bounds from Wails. One recording at a time.
- `StopRecording()` sends the process an interrupt and waits for it, so
  the file is closed.

The service also stops any recording still running when the app quits.

**`frontend/src/lib/demo.ts`** — the player, `runDemo(steps, actions,
sleep)`. A pure interpreter over an `actions` object and a sleep function,
so it is tested with fakes. It stops at the first step that fails and
reports which.

**`App.svelte`** — supplies `actions` from functions it already has:
`openRecent`, `editor.goToLine`, `editor.insertAtCursor` per character,
`openChartBuilder`, `commitChart`, `openTableBuilder`, `commitTable`,
`applyFormat`, and the two recording bindings. Starts the player after
mount when `Script()` returns steps.

## Errors and edges

- A document that fails to open, a `chart` or `table` with its builder not
  open, or an unknown `menu` name stops the script with a toast naming
  the step number and verb.
- `record` without the Screen Recording permission fails at that step
  with a toast saying which permission to grant and to which app.
- `record` while already recording, or `stop` while not, is an error.
- Autosave and the recovery draft behave as in a normal session. A script
  that edits and quits without saving leaves a draft, as a crash would,
  and `quit` is the only way a script ends the app.

## Testing

Go: the parser, one test per verb, bodies including empty and multi-line,
comments and blank lines, relative path resolution, and one malformed
shape per error with the line number it reports.

Vitest: the player with fake actions and a fake clock — order of calls,
typing cadence, line breaks typed as such, stop on the first failed step
with the step number, `stop` implied at end of script.

By hand: the recording itself, on the sample script `docs/demos/chart.demo`,
which opens the test document and inserts a chart, and doubles as the
example for writing others.
