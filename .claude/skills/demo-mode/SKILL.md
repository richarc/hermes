---
name: demo-mode
description: Use when recording or scripting a Hermes demo with HERMES_DEMO, editing demo.go, lib/demo.ts, or docs/demos/*.demo scripts, or debugging screen recording of the app driving itself.
---

# Demo mode

- Demo mode records the app driving itself: `HERMES_DEMO=<script>` at launch (nothing in the app can set it, so production builds honour it too) makes `demo.go` parse the script — one `verb arg` per line, `type`/`chart`/`table` take a body up to a lone `.`, paths relative to the script — and refuse to start on the first bad line. The frontend asks for it once mounted (`DemoService.Script()`; Go cannot know when the page is ready to be pushed to) and `lib/demo.ts` plays it against actions `App.svelte` builds from the same functions the menus call, so the recording shows what a person would see. `record`/`stop` run `screencapture -v -R <window bounds>` from Go and stop it with SIGINT; a recording still running at quit is stopped by `OnShutdown`. The sample is `docs/demos/chart.demo`, and `TestShippedDemoScriptsParse` keeps it parsing. Launch with `open -n "bin/Hermes Editor.app" --env HERMES_DEMO=$PWD/docs/demos/chart.demo` so macOS asks Hermes, not the terminal, for the Screen Recording permission.
