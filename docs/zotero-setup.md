# Setting up Zotero

Hermes resolves citations against a BibTeX file — you write `[@key]`, and the
`.bib` named in your frontmatter says what that key means. Typing keys by hand
works perfectly well, and nothing on this page is required to use citations.

What Zotero adds is a picker: press a key, search your library, and the keys
are inserted for you. If you already keep references in Zotero, this closes
the loop between the library and the document.

For the citation syntax itself — prefixes, locators, narrative citations, the
generated reference list — see [Writing documents for Hermes](hermes-authoring.md).

---

## The one thing to understand first

**Zotero only supplies the key.** Hermes resolves that key against the `.bib`
file named in your frontmatter. It never queries Zotero.

So the picker is only useful when your `.bib` is an export of the same library
you are picking from. Getting this wrong is the most common setup problem, and
it shows up immediately: the key inserts, and then renders red as `[@key?]`
because nothing in the `.bib` matches it.

Everything below is really just the work of keeping those two in step.

---

## Step 1 — Install Zotero and Better BibTeX

1. Install [Zotero](https://www.zotero.org/download/).
2. Install the [Better BibTeX](https://retorque.re/zotero-better-bibtex/)
   plugin: download the `.xpi` **without unzipping it**, then in Zotero open
   **Tools → Plugins** (**Tools → Add-ons** in Zotero 6), click the gear icon,
   choose **Install Plugin From File…**, and select the `.xpi`.
3. Restart Zotero.

Better BibTeX gives every item a stable citation key, shown in the item pane
as **Citation Key**. That key is what goes in your document.

Stability is the point. Zotero's own export invents keys that can change when
an item is edited; Better BibTeX pins one to the item and keeps it, so a
document written today still resolves next year.

## Step 2 — Export your library to a `.bib` that stays current

1. In Zotero, right-click the collection you want, or **My Library**.
2. Choose **Export Collection…**.
3. Set **Format** to **Better BibTeX**.
4. Tick **Keep updated**.
5. Save the file next to your document — `refs.bib`, say.

Step 4 is the one that matters. Without it you get a snapshot that goes stale
the first time you fix a typo in Zotero. With it, Zotero re-exports the file
whenever an item changes, and Hermes picks the change up on its own.

## Step 3 — Point your document at it

```markdown
---
bibliography: refs.bib
csl: apa
---
```

The path is resolved relative to the document, so save the document into the
same folder as `refs.bib`.

`csl` is optional and chooses the citation style — one of `apa`,
`chicago-author-date`, `ieee`, `vancouver` or `harvard`. Anything else falls
back to APA and says so.

## Step 4 — Insert a citation

With Zotero running, put the cursor where the citation belongs and either:

- press **⌘⇧C**, or
- choose **Insert → Citation…**, or
- click **Cite** in the toolbar.

Zotero's picker opens. Search, select one or more items, press Enter, and the
keys arrive at your cursor in Pandoc format. Because your `.bib` is an export
of that same library, they resolve immediately.

The picker is Zotero's own window, so using it brings Zotero forward. Hermes
returns focus to itself once you are done — including from a fullscreen Space,
where macOS would otherwise leave you behind.

Edit an item in Zotero afterwards and the chain runs end to end on its own:
Better BibTeX re-exports, Hermes notices the file changed, and the preview
updates within a couple of seconds. There is nothing to reopen.

---

## Troubleshooting

### "Zotero (with Better BibTeX) isn't running"

Zotero is closed, or Better BibTeX is not installed. Check the connection
independently, so you know which end to fix:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:23119/better-bibtex/cayw?probe=probe"
```

`200` means Zotero and Better BibTeX are reachable and the problem is
elsewhere. Anything else means Zotero's end needs fixing — and no amount of
work in Hermes will help until it returns 200.

### "`[@key]` is not in refs.bib"

The key inserted, but the `.bib` your document names does not contain it. This
is the mismatch described at the top of this page. Either the `.bib` is not an
export of the library you picked from, or the auto-export has not run.

Re-export with **Keep updated** ticked. The message names the exact file
Hermes checked, which is usually enough to see which of the two it is.

The same problem shows in the preview as a red `[@key?]`.

### "Save the document to load refs.bib"

The document has never been saved, so there is no folder to resolve `refs.bib`
against. Save it first — a bibliography cannot be found relative to a document
that is not anywhere yet.
