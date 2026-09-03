# Getting started with Hermes

Hermes is a Markdown editor for academic writing. You type Markdown on the
left and see the finished document on the right, with maths, citations,
charts and diagrams rendered as you go. The file you save is ordinary
Markdown that any other tool can read.

This guide takes you from an empty window to a formatted document. By the
end you will know how to create and save a document, what the block at the
top of every document is for, how to apply the basic formatting, and what
each item under the **View** menu does. Citations, charts, diagrams and
tables have their own guide: [Writing documents for
Hermes](hermes-authoring.md).

---

## 1. Creating a document

### The first launch

The first time Hermes opens it gives you an untitled document with a short
block of comments at the top. You can start typing straight away. Nothing
is on disk until you save, so press **⌘S** early; the save panel asks where
to put the file.

On later launches Hermes shows the welcome pane instead: your recent files,
a **New document** button, and **Open…**.

### File → New… (⌘N)

This is the normal way to start a paper. It asks two things before the save
panel opens:

1. **Include a bibliography** — tick this if you will cite anything. A
   citation-style menu appears; pick one of the five bundled styles
   (`apa`, `chicago-author-date`, `ieee`, `vancouver`, `harvard`). You can
   change it later in the frontmatter.
2. **Bibliography** — which `.bib` file the document will use:
   *Same name as the document* creates `paper.bib` beside `paper.md`; *A new
   file named* lets you choose the name; *An existing file* points at a
   library you already have.

Then the save panel names the document. Hermes writes the document with its
frontmatter already filled in and, if you asked for one, creates the `.bib`
file beside it.

### Saving

- **⌘S** saves. The status bar at the bottom shows the file name, with a
  **•** after it while there are unsaved changes.
- **⌘⇧S** is Save As….
- Hermes also keeps a recovery draft while you have unsaved changes (see
  **Autosave** under the View menu below), so a crash loses at most a couple
  of seconds of typing. The draft is never written over your file; only ⌘S
  changes the document on disk.

---

## 2. The window

- **Editor**, left. Plain Markdown with syntax colouring.
- **Preview**, right. Updates a moment after you stop typing. Links open in
  your browser.
- **Divider** between them. Drag it, or focus it and use the arrow keys.
- **Toolbar** across the top: Open, Save, Cite, Chart, Table, Export PDF.
  Everything on it is also in the menus.
- **Outline**, an optional column on the far left listing the document's
  headings (View → Outline, or the › tab at the left edge).

---

## 3. The frontmatter

Every new document starts with a block like this:

```markdown
---
# To cite: put a .bib file beside this document, name
# it below, then write [@key] in your text. Styles:
# apa, chicago-author-date, ieee, vancouver, harvard.
# bibliography: references.bib
# csl: apa
# toc: true  (a [[toc]] paragraph positions the contents)
---
```

The two lines of `---` fence off the **frontmatter**: settings for the
document, written as `key: value` lines. Hermes reads it and then removes
the whole block before rendering, so nothing in it appears in the preview
or the PDF. That is why the title goes in the document as a heading, not
here: a `title:` line would be silently ignored.

Hermes reads exactly four keys. Everything else is left alone.

| Key | What it does |
|---|---|
| `bibliography` | The `.bib` file citations resolve against. Relative paths are relative to the document, so `references.bib` means the file beside it. |
| `csl` | Citation style: one of the five bundled names above. Anything else falls back to APA with a warning. |
| `toc` | `true` renders a table of contents, at the first paragraph containing `[[toc]]` or, if there is none, at the top. |
| `toc-depth` | How many heading levels the contents lists. Default 3. |

The lines in the new-document template begin with `#`, which makes them
comments. To switch one on, delete the `#` and the space:

```markdown
---
bibliography: references.bib
csl: apa
---
```

A document created with **File → New…** and a bibliography already has
these two lines live. A document without one keeps the commented template,
so the instructions are there when you need them.

You can leave the frontmatter out entirely; a document with no `---` block
at the top is fine.

---

## 4. Writing and formatting

Hermes documents are Markdown, so every format has a plain-text spelling you
can type by hand. The **Format** menu and its shortcuts write the same
characters for you, and they *toggle*: apply a format to text that already
has it and it is removed.

Two rules hold for every command. Formatting never touches the frontmatter
or the inside of a code block, so a stray ⌘B on a line of code does nothing.
And **⌘Z** undoes it.

### Paragraphs

A paragraph is a run of lines. Leave a blank line to start a new one; a
single line break inside a paragraph is treated as a space.

### Headings

Put the cursor on a line and press **⌘1** to **⌘6** for heading levels one
to six, or **⌘0** to turn it back into a paragraph. In Markdown a heading
is a line starting with `#` signs, one per level:

```markdown
# The title of the paper
## 1. Introduction
### 1.1 Background
```

The title is a level-one heading. Sections and subsections are levels two
and three. The outline panel lists these in order, and the table of
contents (if you turn it on) is built from them.

Pressing the same level again removes the heading. Pressing a different
level changes it.

### Bold, italic and the rest

| Format | Shortcut | Markdown |
|---|---|---|
| Bold | **⌘B** | `**text**` |
| Italic | **⌘I** | `*text*` |
| Inline code | **⌘⇧K** | `` `text` `` |
| Strikethrough | **⌘⇧X** | `~~text~~` |

Select some text and press the shortcut. With nothing selected, the
command inserts the pair of marks and leaves the cursor between them, so
type the word and press the right arrow to step out. Bold and italic
combine: `***text***` is both.

### Lists

Put the cursor on a line (or select several lines) and press **⌘⇧8** for a
bulleted list or **⌘⇧7** for a numbered one. The command adds the marker
to the start of each line and removes it if every line already has one.

```markdown
- First point
- Second point
  - A sub-point, indented by two spaces

1. First step
2. Second step
```

For a nested list, indent the line. Numbered lists renumber themselves in
the preview, so the numbers you type do not have to be right.

### Blockquotes

**Format → Blockquote** prefixes the line with `> `. There is no shortcut.

### Links and images

```markdown
See [the project page](https://example.org) for details.

![The alt text becomes the caption](figure.png)
```

An image sits beside the document (or at a path relative to it). Give it alt
text and Hermes turns it into a numbered figure with that text as the
caption. Leave the alt text empty for a plain image with no number.

### Code

**Insert → Code Block** offers a list of languages and inserts a fenced
block:

````markdown
```python
print("hello")
```
````

The language name after the opening fence switches on syntax colouring in
the editor and the preview. Blocks can be folded out of the way with **View
→ Fold Block** (⌘⌥[) while you write the prose around them.

### Tables

**Insert → Table…** opens a grid where you type the cells and set each
column's alignment; it writes a Markdown pipe table into the document. Put
the cursor inside an existing table and use the same item to edit it.

### Maths

Inline maths goes between single dollar signs and display maths between
double:

```markdown
The energy is $E = mc^2$.

$$
\int_0^1 f(x)\,dx
$$
```

Anything KaTeX accepts works. The spell checker leaves the inside of maths
alone.

### Citations

With a bibliography set in the frontmatter, `[@smith2020]` cites the entry
whose key is `smith2020` and a References section appears at the end of the
document. **Insert → Citation…** (⌘⇧C) picks from Zotero. The details, and
how to keep the `.bib` file current, are in
[hermes-authoring.md](hermes-authoring.md) and
[zotero-setup.md](zotero-setup.md).

---

## 5. The View menu

Every choice here is remembered between launches.

**Sync Scrolling.** When on, scrolling the editor scrolls the preview to
match. When off, the two panes scroll independently. Clicking an entry in
the outline moves both panes regardless, because you asked to go there.

**Outline (⌘⌥O).** Shows or hides the headings panel on the left. Click a
heading to put the cursor on it and scroll both panes to it. The ‹ arrow in
the panel and the › tab at the window's edge do the same as the menu item.

**Autosave.** On by default. While the document has unsaved changes, Hermes
writes a recovery draft a couple of seconds after you stop typing. The
draft lives beside Hermes's own settings, never over your file. If Hermes
quits without saving (a crash, a force-quit), the next time you open that
document it asks whether to restore the draft. Saving, or choosing Don't
Save, removes the draft. Turning this off stops the drafts; ⌘S still works
exactly as before.

**Check Spelling.** On by default. Misspelled words are underlined as you
type them, using the Mac's own spelling checker, and a right-click offers
corrections. Code, maths, citation keys, link addresses, HTML and the
frontmatter are not checked. Two things to know: macOS checks the word you
just typed and the word you leave, not a document you open, so an existing
paper shows no underlines until you edit or move through it; and turning
the setting off stops new underlines but leaves the existing ones until
their line is edited or the document reopened.

**Appearance.** System, Light or Dark. System follows the Mac's setting.

**Figure Alignment.** Left, Centre or Right, for every figure, chart and
image in the document at once.

**Chart Width.** Small, Medium or Large, for every chart in the document.

**Fold Block (⌘⌥[) and Unfold Block (⌘⌥]).** Collapse or expand the block
the cursor is in: a heading's whole section, a list, a blockquote, or a
code block, chart or diagram. A folded block shows as one line, so a long
chart specification does not fill the editor while you write the prose
around it. **Fold All Code Blocks** folds every fenced block at once, and
**Unfold All** opens everything. Folding changes only what the editor
shows; the preview and the file are unaffected.

---

## 6. Getting the document out

**File → Export PDF…** (⌘E) writes a PDF of the preview: maths, figures,
charts, the contents page and the References section included. **File →
Paper Size** (A4 or Letter) and **File → PDF Orientation** set the page,
and the preview is drawn at that size so what you see is what prints.

**File → Print…** (⌘P) opens the system print panel.

---

## Where next

- [Writing documents for Hermes](hermes-authoring.md): citations, charts,
  diagrams, figures and the table of contents in full.
- [Setting up Zotero](zotero-setup.md): the citation picker and keeping a
  `.bib` file in sync with your library.
- [The test document](test-document.md): every feature, one section each.
  Open it in Hermes and read it beside the preview.
- **Help → Report an Issue…** opens a bug report with the version already
  filled in.
