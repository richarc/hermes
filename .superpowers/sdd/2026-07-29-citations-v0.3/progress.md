# SDD ledger — plan: docs/superpowers/plans/2026-07-29-citations-v0.3.md

Worktree: .claude/worktrees/citations-v0.3 (branch feature/citations-v0.3, base f3387dc)
Note: Task 10 (release) is plan-gated on human GUI verification — stop after Task 9 + final review and hand to the human.
Note: GUI manual steps (CAYW picker, auto-export refresh, PDF) consolidated for human verification.
Task 1: minor (deferred): CRLF input silently disables frontmatter detection; closing-fence match is substring not line-exact; cosmetic type-cast and quote-strip nits
Task 1: complete (commits f3387dc..a3e9bcb, review clean; RED evidence in report file per process)
Task 2: minor (deferred): extractString drops extra array elements silently; tsconfig types:[node] project-wide; editor-field mapping untested
Task 2: fix round 1/5 (1 addressed, 0 open — phantom empty-key entries filtered; commits 2e779b0..ddfbb85)
Task 2: complete (commits a3e9bcb..ddfbb85, review clean)
Task 3: review found Critical in plan's own reference code — citeproc update index is submitted-order not original-order; fix round 1 dispatched (remap)
Task 3: accepted deviation: vancouver.csl vendored from NLM citation-sequence (upstream URL 404; XML metadata confirms Vancouver/ICMJE family); citeproc.d.ts added (svelte-check)
Task 3: fix round 1/5 (1 addressed, 0 open — submittedToOriginal remap; commits 2f2bcb6..2a284f1)
Task 3: minor (deferred): has(key) not exercised by committed suite
Task 3: complete (commits ddfbb85..2a284f1, review clean)
Task 4: review found Important (from plan sketch) — naive first-] scan hijacks links/refs containing @; fix round 1 dispatched (balanced scan + link lookahead bail)
Task 4: fix round 1/5 (4 addressed incl. honest case-2 CommonMark deviation, 1 new open — pre-emptive link bail drops citations when deferred link fails; commits 071ca4b..663f46e)
Task 4: fix round 2 dispatched — reorder bracket rule AFTER link, delete bail
Task 4: fix round 2/5 (1 addressed, 0 open — rule reordered after link + no-nested-bracket guard; commits 663f46e..0de10c5)
Task 4: minor (deferred): escaped-bracket (\]) not escape-aware in scan (pre-existing parity with sketch)
Task 4: complete (commits 2a284f1..0de10c5, review clean)
Task 5: review found Critical — unescaped citekey HTML injection in cite-error branch (KEY_RE allows &<>); fix round 1 dispatched
Task 5: minor (deferred): unresolved clusters drop locator/prefix text in error rendering (matches brief; fidelity follow-up); unused 'whole' param
Task 5: fix round 1/5 (1 addressed, 0 open — citekeys escaped in cite-error; commits dc76eb2..4ae7896)
Task 5: minor (deferred): raw-fallback branch double-escapes (dead-defensive code path, unreachable in a normal pass; re-reviewer's display claim inverted but impact nil)
Task 5: complete (commits 0de10c5..4ae7896, review clean)
Task 6: minor (deferred): re-arm overlap window (cancel is signal not join; benign spurious bib:changed possible on rapid doc switch); default emit path resolution note
Task 6: complete (commits 4ae7896..a29081d, review clean)
Task 7: minor (deferred): caywBase naive concat (trailing-slash hazard if ever configurable)
Task 7: complete (commits a29081d..f2db105, review clean)
Task 8: review Approved but 1 Important — reloadBibliography self-race (no epoch guard); fix round 1 dispatched (generation counter + drop dead bibPath)
Task 8: minor (deferred): sequential toasts clobber each other (warnings+unknown-csl case)
Task 8: fix round 1/5 (1 addressed, 0 open — generation counter + dead bibPath removed; commits c878361..45cb992)
Task 8: complete (commits f2db105..45cb992, review clean)
Task 9: complete (commits 45cb992..54c0173, review clean)
Final review (f3387dc..54c0173): diff generated, 10 probes written to frontend/src/lib/__probe__.test.ts, session died before a report was produced
Final review: probes triaged on resume — 9 of 10 clean (citeproc escapes malicious bib titles/authors/prefixes; math+vega unaffected by frontmatter)
Final review: fix round 1/5 (1 addressed, 0 open) — softbreak placeholder substitution: a hard-wrapped citation group left raw markup + data-cite-index visible in preview/PDF while still adding its reference (renderer.ts regex lacked the s flag); 2 regression tests + visual-test.md coverage
Final review: minor (deferred, all pre-existing and already logged above): CRLF frontmatter (Task 1), escaped \] backslash leak (Task 4), error-branch prefix/locator fidelity (Task 5)
Next: human GUI verification (CAYW picker, BBT auto-export refresh, PDF with References, visual-test section 9) — then Task 10 release
Post-review addition: docs/sample-paper.md + sample-paper.bib — demo/test document covering every citation form, 10 entries across 7 BibTeX types, negative + error cases; verified by rendering through the real pipeline in all 5 bundled styles (commit 2f76a60)
Post-review UX fix (from human GUI verification): both silent-failure toasts — picked key absent from the document's .bib, and unsaved document cannot load a named bibliography; logic extracted to lib/citationFeedback.ts (14 tests), App.svelte wiring untested (no component test infra); binary rebuilt (commit bc0e4da)
Deferred minors closed: CRLF frontmatter (Task 1) fixed with line-exact closing fence (also closes the substring-fence minor); empty-block regression guard added; __probe__.test.ts deleted (untracked, findings already recorded) so plain npm test is clean at 84 tests
