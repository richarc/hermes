# Hermes Roadmap

Hermes is a desktop editor for writing academic papers in markdown, with LaTeX
math and Vega-Lite charts rendered live and exported to PDF. Releases follow
[Semantic Versioning](https://semver.org); see [CHANGELOG.md](CHANGELOG.md) for
what has shipped.

## v0.1.0 — Core editor ✅ (released 2026-07-28)

The working foundation: split-view editing with live preview (markdown +
KaTeX math + Vega-Lite charts), native file handling with recents and dirty
tracking, and PDF export via the print panel. Design and plan documents live in
`docs/superpowers/`.

## v0.2.0 — Refinements and fixes (in planning)

Feature list to be defined. Candidates carried over from v0.1 review notes:

- [x] Bug: the Open / Save / Export PDF toolbar buttons overlap the standard
      macOS window controls (traffic lights). Fixed by insetting the toolbar's
      left padding to clear them (hidden-inset title bar retained).
- [x] Chart lifecycle polish: Vega views are now `finalize()`d when their
      chart leaves the document, and hydration passes are generation-guarded
      so rapid re-renders can't interleave (charts.ts hydrator factory).
- [x] In-session file navigation: File → New (⌘N) and a File → Open Recent
      submenu (with Clear Recents) that rebuilds as the list changes.
- [ ] Bug: the app is named "My Product" in the menu bar and About dialog
      (template defaults in `build/config.yml`). Rename to "Hermes Editor"
      and regenerate the build assets.
- [ ] Bug: printing / PDF preview defaults to landscape. Make portrait the
      default and provide a way to choose the orientation.
- [ ] Bug: the window corner radius is noticeably larger than other macOS
      apps. Reduce it to match the platform norm.
- [ ] Dirty-state edge case: a document deleted back to empty still counts as
      dirty; re-evaluate against last-saved content.
- [ ] Keyboard accessibility for the pane divider (currently mouse-only).
- [ ] Strip unused template assets from `frontend/public/` (embedded into the
      shipped binary).
- [ ] Docs: correct the stale `data-wml-openURL` note in CLAUDE.md.
- [ ] Revisit Vite 8 once the upstream Rolldown lone-surrogate bug is fixed
      (v0.1 pinned Vite 7 to keep KaTeX's lexer intact).

## v0.3.0 — Citations and bibliography

The headline academic feature (previously referred to as "v2"):

- BibTeX support: a `.bib` file per document.
- `[@key]` citation syntax rendered in the preview and in the PDF.
- Bibliography generation via citeproc with CSL styles.

## Backlog (unscheduled)

Ideas noted along the way, not yet committed to a release:

- Dark theme (theme-aware app chrome, preview, and CodeMirror theme) — v0.1
  deliberately pins a light scheme.
- Dialog-free PDF export (e.g. headless rendering) if the print panel proves
  clunky.
- Windows/Linux support (paths, menus, and print behavior are currently
  macOS-focused).
- Security hardening for third-party documents (Vega-Lite specs can trigger
  remote `data.url` fetches).
