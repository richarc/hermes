### Task 9: Visual test document + docs

**Files:**
- Modify: `docs/visual-test.md`, `CLAUDE.md`
- Create: `docs/visual-test.bib`

**Interfaces:** none new — this task packages manual verification.

- [ ] **Step 1: Create `docs/visual-test.bib`** with `smith2020`, `doe2021`, and `smith2020x` entries (reuse Task 2's fixture content, adding a second Smith 2020 article for disambiguation).

- [ ] **Step 2: Extend `docs/visual-test.md`**: add frontmatter (`bibliography: visual-test.bib`, `csl: apa`) at the very top, and a new section 9 before the intentional-errors section:

```markdown
## 9. Citations

A simple citation [@smith2020], a multi-cite [@smith2020; @doe2021], a
narrative citation: @doe2021 argues the point. Suppressed author [-@smith2020],
with locator [see @doe2021, pp. 33-35], and disambiguation [@smith2020; @smith2020x].
An unknown key must show an inline error: [@notakey1999].

A References section should appear at the end of this document, before nothing —
check it lists Smith (2020a, 2020b) and Doe (2021), and that ⌘E includes it in
the PDF without splitting entries across pages.
```
Renumber the intentional-errors section to 10 and add the unknown-key line above to its checklist sentence if needed.

- [ ] **Step 3: CLAUDE.md**: in the architecture section's frontend-pipeline bullet, add one sentence: citations are parsed by `lib/citations.ts` (markdown-it rule + citeproc-js formatter), bibliography data comes from a frontmatter-named `.bib` read/watched through Go (`bib:changed`), and Zotero insertion uses BBT's CAYW via `PickCitations`.

- [ ] **Step 4: Gates + commit** — full frontend + Go gates; `git commit -m "docs: citations section in visual test document"`

---

