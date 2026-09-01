# Recovery Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a document is dirty, write a recovery draft beside the settings file two seconds after the last change, and offer it back on the next open of that document if the file on disk has not caught up; explicit Save stays the only thing that writes the document.

**Architecture:** A `draftStore` in `recovery.go` owns the drafts directory (key, write, discard, find, prune) and is exposed through three `DocumentService` methods. A pure `lib/recoveryDraft.ts` keeper decides *when* to write and discard (debounce, dirty transitions, ordered queue) and is unit-tested with fake timers. `App.svelte` feeds the keeper from one `$effect` over `path`/`content`/`dirty`/`autoSave`, asks Go for a draft after every open and once at launch, and shows a `Dialog` to restore or discard it. A new `AutoSave` setting with a View → Autosave checkbox gates writes.

**Tech Stack:** Go 1.25, Wails v3 beta.12 bindings, Svelte 5 runes, TypeScript, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-01-recovery-drafts-design.md` (decisions); `ROADMAP.md` Autosave item (origin).

## Global Constraints

- Go: `go test ./. && go build -o /dev/null .` from the repo root. Use `.`, not `./...`.
- Frontend commands run from `frontend/`: `npx vitest run <file>` for one file, `npx vitest run` for all, `npm run check` for types.
- Never hand-edit `frontend/bindings/`. Task 3 changes the Go service API, so it regenerates them with `wails3 task common:generate:bindings` and commits the result.
- No literal colours in CSS. This plan adds no CSS.
- `wails3 task run` does not build. The real-app check is `wails3 task build && wails3 task run`, after confirming the binary carries a new symbol: `strings "bin/Hermes Editor" | grep -c RecoverDraft`.
- Commit after each task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Work on a branch `recovery-drafts` off `main`.
- Copy, exactly: setting JSON key `autoSave`; menu item `Autosave`; dialog label `Recover draft`; buttons `Discard Draft` and `Restore`; dialog texts and toast as written in Task 5.
- Draft debounce is 2000 ms, exported as `DRAFT_DEBOUNCE_MS` and passed to the keeper explicitly by `App.svelte` (the App tests mock that export to shorten it).

---

## File structure

| File | Responsibility |
|---|---|
| `settings.go` | `AutoSave` field, default, and the unmarshal-over-defaults fix. |
| `settings_test.go` | Default, persistence, missing-key-reads-as-default. |
| `recovery.go` (new) | `Draft`, `draftStore`: key, write, discard, find (with the superseded rules), prune. |
| `recovery_test.go` (new) | Store behaviour on a temp dir. |
| `documentservice.go` | `drafts *draftStore` on the service; `WriteDraft`/`DiscardDraft`/`RecoverDraft` bindings. |
| `menu.go` | View → Autosave checkbox. |
| `frontend/bindings/hermes/*` | Regenerated. |
| `frontend/src/lib/recoveryDraft.ts` (new) | `createDraftKeeper`: debounce, dirty transitions, ordered write/discard queue, `settle`. Pure. |
| `frontend/src/lib/recoveryDraft.test.ts` (new) | Keeper tests under fake timers. |
| `frontend/src/App.svelte` | Keeper wiring, `autoSave` state, recovery dialog, launch-time untitled check, settle-before-quit. |
| `frontend/src/App.test.ts` | Draft written on typing, discarded on save, gated by the setting, restore/discard dialog, untitled recovery at launch. |
| `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md` | Docs. |

---

### Task 1: The `AutoSave` setting

**Files:**
- Modify: `settings.go`
- Modify: `settings_test.go`
- Test: `settings_test.go`

**Interfaces:**
- Produces: `Settings.AutoSave bool` with JSON key `autoSave`, default `true`. Later tasks read `docs.Settings().AutoSave` (Go) and `s.autoSave` (TS, after Task 3 regenerates the bindings).

- [ ] **Step 1: Write the failing tests**

Append to `settings_test.go`:

```go
func TestAutoSaveDefaultsToOn(t *testing.T) {
	s := newTestService(t)
	if !s.Settings().AutoSave {
		t.Error("autosave must default to on")
	}
}

func TestAutoSavePersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)
	next := s.Settings()
	next.AutoSave = false
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if NewDocumentService(recentsPath).Settings().AutoSave {
		t.Error("want autosave off after update, in a fresh service")
	}
}

// A settings file written before this field existed has no autoSave key.
// The loader used to unmarshal into a zero Settings, so an absent bool read
// as false — which would have switched autosave off for every existing
// install on upgrade. Absent keys must take the default instead.
func TestSettingsFileWithoutAutoSaveKeyReadsAsOn(t *testing.T) {
	dir := t.TempDir()
	body := `{"printOrientation":"landscape","syncScrolling":true}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got := NewDocumentService(filepath.Join(dir, "recents.json")).Settings()
	if !got.AutoSave {
		t.Error("an absent autoSave key must read as the default, on")
	}
	if got.PrintOrientation != "landscape" || !got.SyncScrolling {
		t.Errorf("present keys must still be read: %+v", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./. -run 'TestAutoSave|TestSettingsFileWithoutAutoSaveKey' -v`
Expected: compile error, `s.Settings().AutoSave undefined`.

- [ ] **Step 3: Add the field, default and loader fix**

In `settings.go`, add the field to the struct and the default:

```go
type Settings struct {
	PrintOrientation string `json:"printOrientation"`
	SyncScrolling    bool   `json:"syncScrolling"`
	Theme            string `json:"theme"`
	FigureAlignment  string `json:"figureAlignment"`
	ChartWidth       string `json:"chartWidth"`
	PaperSize        string `json:"paperSize"`
	ShowOutline      bool   `json:"showOutline"`
	// Writes a recovery draft while the document is dirty. See recovery.go.
	AutoSave bool `json:"autoSave"`
}

func defaultSettings() Settings {
	return Settings{
		PrintOrientation: "portrait",
		SyncScrolling:    false,
		Theme:            "system",
		FigureAlignment:  "centre",
		ChartWidth:       "medium",
		PaperSize:        "a4",
		ShowOutline:      false,
		AutoSave:         true,
	}
}
```

Update the comment at the top of `normalise` so it names the new bool:

```go
	// SyncScrolling, ShowOutline and AutoSave need no clause: every value a
	// bool can hold is valid.
```

In `loadLocked`, unmarshal over the defaults rather than a zero value:

```go
	if data, err := os.ReadFile(st.path); err == nil {
		// Over the defaults, not a zero value: a key absent from the file
		// (one written before the field existed) keeps its default. With a
		// zero value an absent bool read as false, which is wrong for any
		// bool whose default is true.
		parsed := defaultSettings()
		if err := json.Unmarshal(data, &parsed); err == nil {
			st.current = parsed.normalise()
		}
	}
```

- [ ] **Step 4: Run the Go tests**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS. `TestSettingsFallsBackWhenFileIsUnreadable`'s `null` case still passes: `json.Unmarshal` of `null` into a struct leaves it untouched, so it stays at the defaults.

- [ ] **Step 5: Commit**

```bash
git add settings.go settings_test.go
git commit -m "feat: an AutoSave setting, on by default, with absent keys reading as their default

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The draft store

**Files:**
- Create: `recovery.go`
- Create: `recovery_test.go`
- Modify: `documentservice.go:24-56` (struct and constructor) and append three methods

**Interfaces:**
- Consumes: `writeFileAtomic(path string, data []byte, perm os.FileMode) error` from `atomicwrite.go`.
- Produces:
  ```go
  type Draft struct { Found bool `json:"found"`; Content string `json:"content"` }
  func draftKey(docPath string) string
  func newDraftStore(dir string) *draftStore
  func (d *draftStore) write(docPath, content string) error
  func (d *draftStore) discard(docPath string) error
  func (d *draftStore) find(docPath string) (Draft, error)
  func (d *draftStore) prune(now time.Time)
  func (s *DocumentService) WriteDraft(docPath, content string) error
  func (s *DocumentService) DiscardDraft(docPath string) error
  func (s *DocumentService) RecoverDraft(docPath string) (Draft, error)
  ```

- [ ] **Step 1: Write the failing tests**

Create `recovery_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestDraftStore(t *testing.T) *draftStore {
	t.Helper()
	return newDraftStore(filepath.Join(t.TempDir(), "drafts"))
}

func TestDraftKeyIsUntitledForNoPathAndStableOtherwise(t *testing.T) {
	if got := draftKey(""); got != "untitled" {
		t.Errorf("want untitled for an empty path, got %q", got)
	}
	a, b := draftKey("/papers/a.md"), draftKey("/papers/b.md")
	if a == b {
		t.Error("different paths must not share a key")
	}
	if a != draftKey("/papers/a.md") {
		t.Error("the key must be a pure function of the path")
	}
	if filepath.Base(a) != a || len(a) != 16 {
		t.Errorf("want a 16-char filename-safe key, got %q", a)
	}
}

func TestDraftRoundTripAndDiscard(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("saved"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The document is older than the draft about to be written.
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(doc, old, old); err != nil {
		t.Fatal(err)
	}

	if err := d.write(doc, "saved plus more"); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	if !got.Found || got.Content != "saved plus more" {
		t.Errorf("want the draft back, got %+v", got)
	}

	if err := d.discard(doc); err != nil {
		t.Fatalf("discard: %v", err)
	}
	got, err = d.find(doc)
	if err != nil {
		t.Fatalf("recover after discard: %v", err)
	}
	if got.Found {
		t.Error("a discarded draft must not be offered")
	}
	// Discarding twice is not an error: the second call has nothing to do.
	if err := d.discard(doc); err != nil {
		t.Errorf("discard of a missing draft must be a no-op, got %v", err)
	}
}

func TestDraftIsPrivateToTheUser(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "x"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("want 0600, got %o", got)
	}
}

func TestRecoverIsNotFoundWithoutADraft(t *testing.T) {
	d := newTestDraftStore(t)
	got, err := d.find("/nowhere/paper.md")
	if err != nil || got.Found {
		t.Errorf("want not found and no error, got %+v, %v", got, err)
	}
}

func TestRecoverDropsADraftTheDocumentHasCaughtUpWith(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := d.write(doc, "v1 plus"); err != nil {
		t.Fatal(err)
	}
	// The document is saved after the draft: whatever the draft held, the
	// author has since written the file on purpose.
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(doc, later, later); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.Found {
		t.Error("a draft older than the document must not be offered")
	}
	if _, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json")); !os.IsNotExist(err) {
		t.Error("a superseded draft must be deleted, not just hidden")
	}
}

func TestRecoverDropsADraftIdenticalToTheDocument(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(doc, old, old); err != nil {
		t.Fatal(err)
	}
	if err := d.write(doc, "same"); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.Found {
		t.Error("a draft equal to the file has nothing to offer")
	}
}

func TestRecoverOffersTheDraftWhenTheDocumentIsGone(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "deleted.md")
	if err := d.write(doc, "only copy"); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || got.Content != "only copy" {
		t.Errorf("with no document to compare against the draft is all there is, got %+v", got)
	}
}

func TestRecoverUntitledNeedsNoDocument(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("", "scratch"); err != nil {
		t.Fatal(err)
	}
	got, err := d.find("")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || got.Content != "scratch" {
		t.Errorf("got %+v", got)
	}
}

func TestRecoverDropsEmptyAndUnreadableDrafts(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := d.find(""); got.Found {
		t.Error("an empty draft must not be offered")
	}
	doc := "/papers/x.md"
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d.dir, draftKey(doc)+".json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil || got.Found {
		t.Errorf("an unreadable draft must read as not found without error, got %+v, %v", got, err)
	}
}

func TestPruneRemovesOnlyOldDrafts(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("/papers/old.md", "old"); err != nil {
		t.Fatal(err)
	}
	if err := d.write("/papers/new.md", "new"); err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(d.dir, draftKey("/papers/old.md")+".json")
	stale := time.Now().Add(-31 * 24 * time.Hour)
	if err := os.Chtimes(oldFile, stale, stale); err != nil {
		t.Fatal(err)
	}

	d.prune(time.Now())

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("a draft older than 30 days must be pruned")
	}
	if got, _ := d.find("/papers/new.md"); !got.Found {
		t.Error("a recent draft must survive pruning")
	}
}

func TestPruneOnAMissingDirectoryIsANoOp(t *testing.T) {
	newTestDraftStore(t).prune(time.Now()) // must not panic or create the dir
}

func TestDocumentServiceExposesTheDraftStore(t *testing.T) {
	s := newTestService(t)
	if err := s.WriteDraft("", "from the service"); err != nil {
		t.Fatalf("WriteDraft: %v", err)
	}
	got, err := s.RecoverDraft("")
	if err != nil || !got.Found || got.Content != "from the service" {
		t.Errorf("got %+v, %v", got, err)
	}
	if err := s.DiscardDraft(""); err != nil {
		t.Fatalf("DiscardDraft: %v", err)
	}
	if got, _ := s.RecoverDraft(""); got.Found {
		t.Error("discarded")
	}
	// Drafts live beside recents.json and settings.json, in their own folder.
	wantDir := filepath.Join(filepath.Dir(s.recentsPath), "drafts")
	if s.drafts.dir != wantDir {
		t.Errorf("want drafts at %s, got %s", wantDir, s.drafts.dir)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./. -run 'Draft|Recover|Prune|Find' -v`
Expected: compile errors for `newDraftStore`, `draftKey`, `Draft`.

- [ ] **Step 3: Write `recovery.go`**

```go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// Draft is what RecoverDraft hands the frontend. Found false means there is
// nothing worth offering: no draft, or one the document on disk has caught
// up with. Content is the draft's full text.
type Draft struct {
	Found   bool   `json:"found"`
	Content string `json:"content"`
}

// draftFile is the on-disk shape. The path is stored for a human reading the
// drafts folder; lookups go by key, never by this field.
type draftFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// A draft nobody has opened for this long belongs to a document that was
// renamed, deleted, or abandoned; it is removed at launch.
const draftMaxAge = 30 * 24 * time.Hour

// draftStore keeps one recovery draft per document path in dir. Explicit
// Save is still the act of record — a draft is never written over the
// document — so the only thing this has to get right is not offering a
// draft the document has since caught up with. See find.
type draftStore struct {
	dir string
}

func newDraftStore(dir string) *draftStore {
	return &draftStore{dir: dir}
}

// draftKey names the draft file for a document. An unsaved document has no
// path, so it gets a fixed key and the next launch offers it back. A saved
// document's key is a hash of its path: short, filename-safe, and free of
// the separators and spaces the path itself carries.
func draftKey(docPath string) string {
	if docPath == "" {
		return "untitled"
	}
	sum := sha256.Sum256([]byte(docPath))
	return hex.EncodeToString(sum[:8])
}

func (d *draftStore) file(docPath string) string {
	return filepath.Join(d.dir, draftKey(docPath)+".json")
}

func (d *draftStore) write(docPath, content string) error {
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(draftFile{Path: docPath, Content: content})
	if err != nil {
		return err
	}
	// 0600: the draft is the user's unsaved text, and unlike the document it
	// lives in a folder they did not choose.
	return writeFileAtomic(d.file(docPath), data, 0o600)
}

// discard removes the draft. A draft that is already gone is not an error:
// the frontend discards on every dirty-to-clean transition, and most of
// those have no draft to remove.
func (d *draftStore) discard(docPath string) error {
	err := os.Remove(d.file(docPath))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// find returns the draft for docPath if it is worth offering, and deletes
// it otherwise. Not worth offering: missing, unreadable, empty, older than
// the document (the author saved or edited the file after the draft was
// written), or identical to the document. A document that cannot be read
// does not disqualify the draft — it may be all that is left.
func (d *draftStore) find(docPath string) (Draft, error) {
	name := d.file(docPath)
	data, err := os.ReadFile(name)
	if errors.Is(err, os.ErrNotExist) {
		return Draft{}, nil
	}
	if err != nil {
		return Draft{}, err
	}
	var df draftFile
	if err := json.Unmarshal(data, &df); err != nil || df.Content == "" {
		_ = os.Remove(name)
		return Draft{}, nil
	}
	if docPath != "" && d.supersededByDocument(name, docPath, df.Content) {
		_ = os.Remove(name)
		return Draft{}, nil
	}
	return Draft{Found: true, Content: df.Content}, nil
}

// supersededByDocument reports whether the document has caught up with the
// draft: it was written at or after the draft, or already holds the same
// text. Any failure to read either file reports false, so the draft is kept.
func (d *draftStore) supersededByDocument(draftName, docPath, draftContent string) bool {
	docInfo, err := os.Stat(docPath)
	if err != nil {
		return false
	}
	draftInfo, err := os.Stat(draftName)
	if err != nil {
		return false
	}
	if !docInfo.ModTime().Before(draftInfo.ModTime()) {
		return true
	}
	doc, err := os.ReadFile(docPath)
	if err != nil {
		return false
	}
	return string(doc) == draftContent
}

// prune deletes drafts untouched for longer than draftMaxAge. Best effort:
// a missing folder or an unreadable entry is skipped, never reported.
func (d *draftStore) prune(now time.Time) {
	entries, err := os.ReadDir(d.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > draftMaxAge {
			_ = os.Remove(filepath.Join(d.dir, e.Name()))
		}
	}
}
```

- [ ] **Step 4: Wire the store into `DocumentService`**

In `documentservice.go`, add the field to the struct (after `settings`):

```go
	settings    *settingsStore
	drafts      *draftStore
```

Extend the constructor:

```go
func NewDocumentService(recentsPath string) *DocumentService {
	dataDir := filepath.Dir(recentsPath)
	s := &DocumentService{
		recentsPath: recentsPath,
		settings:    newSettingsStore(filepath.Join(dataDir, "settings.json")),
		drafts:      newDraftStore(filepath.Join(dataDir, "drafts")),
		watchTick:   2 * time.Second,
		caywBase:    "http://127.0.0.1:23119",
	}
	s.drafts.prune(time.Now())
	return s
}
```

Append the bindings after `IsDirty`:

```go
// WriteDraft, DiscardDraft and RecoverDraft are the recovery-draft bindings.
// The frontend decides *when* (lib/recoveryDraft.ts: debounced while dirty,
// discarded on the dirty-to-clean transition); the store decides whether a
// draft is still worth offering. See recovery.go.
func (s *DocumentService) WriteDraft(docPath, content string) error {
	return s.drafts.write(docPath, content)
}

func (s *DocumentService) DiscardDraft(docPath string) error {
	return s.drafts.discard(docPath)
}

func (s *DocumentService) RecoverDraft(docPath string) (Draft, error) {
	return s.drafts.find(docPath)
}
```

- [ ] **Step 5: Run the Go tests**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add recovery.go recovery_test.go documentservice.go
git commit -m "feat: a recovery-draft store keyed by document path, exposed as three bindings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Bindings and the View → Autosave menu item

**Files:**
- Modify: `menu.go:250-257` (after the Outline checkbox)
- Regenerate: `frontend/bindings/hermes/documentservice.ts`, `frontend/bindings/hermes/models.ts`

**Interfaces:**
- Consumes: `Settings.AutoSave` (Task 1); `WriteDraft`/`DiscardDraft`/`RecoverDraft` (Task 2).
- Produces: `DocumentService.WriteDraft(docPath, content)`, `DocumentService.DiscardDraft(docPath)`, `DocumentService.RecoverDraft(docPath): Promise<Draft>`, `Settings.autoSave: boolean` and `interface Draft { found: boolean; content: string }` in TS.

- [ ] **Step 1: Regenerate the bindings**

Run from the repo root: `wails3 task common:generate:bindings`
Then: `grep -n 'RecoverDraft\|WriteDraft\|DiscardDraft' frontend/bindings/hermes/documentservice.ts` and `grep -n 'autoSave\|interface Draft' frontend/bindings/hermes/models.ts`
Expected: three new functions; `"autoSave": boolean;` on `Settings`; a `Draft` interface with `found` and `content`.

- [ ] **Step 2: Add the menu item**

In `menu.go`, directly after the Outline checkbox block and before `view.AddSeparator()`:

```go
	// Below Outline: a persisted on/off like Sync Scrolling, and the View
	// menu is where those live. No accelerator; this is set once, not
	// toggled mid-sentence. Same read-modify-write as the two above.
	view.AddCheckbox("Autosave", viewCurrent.AutoSave).OnClick(func(*application.Context) {
		next := docs.Settings()
		next.AutoSave = !next.AutoSave
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save autosave: %v", err)
		}
	})
```

- [ ] **Step 3: Build and type-check**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS.
Run from `frontend/`: `npm run check`
Expected: no errors. Nothing consumes the new bindings yet.

- [ ] **Step 4: Commit**

```bash
git add menu.go frontend/bindings
git commit -m "feat: View → Autosave, and regenerated bindings for the draft store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `lib/recoveryDraft.ts`, the keeper

**Files:**
- Create: `frontend/src/lib/recoveryDraft.ts`
- Create: `frontend/src/lib/recoveryDraft.test.ts`

**Interfaces:**
- Consumes: `debounce` from `frontend/src/lib/debounce.ts`.
- Produces:
  ```ts
  export const DRAFT_DEBOUNCE_MS = 2000
  export interface DraftSink {
    write(docPath: string, content: string): Promise<void>
    discard(docPath: string): Promise<void>
  }
  export interface DraftKeeper {
    update(docPath: string, content: string, dirty: boolean, enabled: boolean): void
    reset(): void
    settle(): Promise<void>
  }
  export function createDraftKeeper(sink: DraftSink, wait: number): DraftKeeper
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/recoveryDraft.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDraftKeeper, DRAFT_DEBOUNCE_MS, type DraftSink } from './recoveryDraft'

function sink() {
  return {
    write: vi.fn(async (_p: string, _c: string) => {}),
    discard: vi.fn(async (_p: string) => {}),
  } satisfies DraftSink
}

describe('createDraftKeeper', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('exports a two-second default', () => {
    expect(DRAFT_DEBOUNCE_MS).toBe(2000)
  })

  it('writes once after the wait, with the latest content', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    k.update('/p.md', 'ab', true, true)
    vi.advanceTimersByTime(99)
    expect(s.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await k.settle()
    expect(s.write).toHaveBeenCalledExactlyOnceWith('/p.md', 'ab')
  })

  it('never writes a clean document', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', false, true)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('never writes while the setting is off, and drops a write already pending', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    k.update('/p.md', 'ab', true, false)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
  })

  it('cancels the pending write and discards when the document goes clean', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(50)
    k.update('/p.md', 'a', false, true) // saved
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('discards on the clean transition even when the setting is off', async () => {
    // A draft written before the setting was switched off must still go
    // when the document is saved.
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, false)
    k.update('/p.md', 'a', false, false)
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('discards only on a dirty-to-clean transition, not on every clean update', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', '', false, true)
    k.update('/p.md', '', false, true)
    await k.settle()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('queues the discard behind a write still in flight', async () => {
    const s = sink()
    let finishWrite!: () => void
    s.write.mockImplementationOnce(() => new Promise<void>((r) => (finishWrite = r)))

    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(100) // the debounce fires; the write is queued
    k.update('/p.md', 'a', false, true) // saved while it is in flight
    // The queue runs its callbacks on microtasks: let the write start.
    await Promise.resolve()
    await Promise.resolve()
    expect(s.write).toHaveBeenCalledOnce()
    expect(s.discard).not.toHaveBeenCalled()
    finishWrite()
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('reset drops the pending write and forgets the dirty state', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/old.md', 'a', true, true)
    k.reset()
    k.update('/new.md', 'fresh', false, true)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('a rejected sink call does not wedge the queue', async () => {
    const s = sink()
    s.write.mockRejectedValueOnce(new Error('disk full'))
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(100)
    await k.settle()
    k.update('/p.md', 'a', false, true)
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `frontend/`: `npx vitest run src/lib/recoveryDraft.test.ts`
Expected: FAIL, cannot resolve `./recoveryDraft`.

- [ ] **Step 3: Write the keeper**

Create `frontend/src/lib/recoveryDraft.ts`:

```ts
import { debounce } from './debounce'

/** How long after the last change a recovery draft is written. Exported so
    App.svelte passes it explicitly, which lets App.test.ts mock it short. */
export const DRAFT_DEBOUNCE_MS = 2000

/** The Go side of the drafts: WriteDraft and DiscardDraft in App.svelte. */
export interface DraftSink {
  write(docPath: string, content: string): Promise<void>
  discard(docPath: string): Promise<void>
}

export interface DraftKeeper {
  /** Called from one $effect on every change to the path, the text, the
      dirty flag or the setting. docPath is '' for an unsaved document. */
  update(docPath: string, content: string, dirty: boolean, enabled: boolean): void
  /** The document was swapped for another: drop the pending write and
      forget the old document's dirty state, so the swap is not mistaken
      for a save. */
  reset(): void
  /** Resolves once every queued write and discard has finished. Awaited
      before quitting, so a Save-then-quit does not leave a draft behind. */
  settle(): Promise<void>
}

// The keeper decides *when*; recovery.go decides whether a draft is still
// worth offering. Two rules here: write only while dirty and enabled, a
// debounce after the last change; discard on the dirty-to-clean transition.
// Writes and discards go through one promise chain so a discard can never
// overtake a write that is still in flight and leave the draft it meant to
// remove on disk.
export function createDraftKeeper(sink: DraftSink, wait: number): DraftKeeper {
  let queue: Promise<void> = Promise.resolve()
  let wasDirty = false

  // The sink reports its own failures (App toasts a write failure); the
  // catch here only keeps a rejection from wedging every later operation.
  const enqueue = (op: () => Promise<void>) => {
    queue = queue.then(op).catch(() => {})
  }

  const scheduleWrite = debounce((docPath: string, content: string) => {
    enqueue(() => sink.write(docPath, content))
  }, wait)

  return {
    update(docPath, content, dirty, enabled) {
      if (dirty && enabled) scheduleWrite(docPath, content)
      else scheduleWrite.cancel()
      // Not gated on `enabled`: a draft written before the setting was
      // switched off still has to go when the document is saved.
      if (!dirty && wasDirty) enqueue(() => sink.discard(docPath))
      wasDirty = dirty
    },
    reset() {
      scheduleWrite.cancel()
      wasDirty = false
    },
    settle() {
      return queue
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run from `frontend/`: `npx vitest run src/lib/recoveryDraft.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/recoveryDraft.ts frontend/src/lib/recoveryDraft.test.ts
git commit -m "feat: a draft keeper — debounced while dirty, discarded on the clean transition

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Wire the keeper and the recovery dialog into `App.svelte`

**Files:**
- Modify: `frontend/src/App.svelte` (imports; state near `savedContent`; `refreshSettings`; `loadDocument`; `doNew`; `confirmDiscard`; `finishPending`; `onMount` startup block; template after the unsaved-changes `Dialog`)
- Modify: `frontend/src/App.test.ts` (mock setup at the top; a new `describe('recovery drafts')`)

**Interfaces:**
- Consumes: `createDraftKeeper`, `DRAFT_DEBOUNCE_MS` (Task 4); `DocumentService.WriteDraft`/`DiscardDraft`/`RecoverDraft`, `Settings.autoSave` (Task 3).
- Produces: nothing consumed later. Behaviour is what Task 6 documents.

- [ ] **Step 1: Extend the test mocks**

In `frontend/src/App.test.ts`, inside the `vi.hoisted` block, add `autoSave: true` to `DEFAULT_SETTINGS` and three mocks to `DocumentService`:

```ts
  const DEFAULT_SETTINGS = {
    printOrientation: 'portrait',
    syncScrolling: false,
    showOutline: false,
    theme: 'system',
    figureAlignment: 'centre',
    chartWidth: 'medium',
    autoSave: true,
  }
```

```ts
      CreateDocument: vi.fn(async (path: string, content: string, _bibName: string, _bibContent: string) => ({ path, content })),
      WriteDraft: vi.fn(async (_docPath: string, _content: string) => {}),
      DiscardDraft: vi.fn(async (_docPath: string) => {}),
      RecoverDraft: vi.fn(async (_docPath: string) => ({ found: false, content: '' })),
```

Directly after the existing `vi.mock('../bindings/hermes', ...)` line, shorten the debounce for these tests:

```ts
// The real debounce is two seconds; every test here would wait it out.
// App.svelte passes DRAFT_DEBOUNCE_MS to the keeper explicitly so this
// mock is what it sees.
vi.mock('./lib/recoveryDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/recoveryDraft')>()),
  DRAFT_DEBOUNCE_MS: 20,
}))
```

In `beforeEach`, after `recents.current = []`, reset the settings so a test that switches autosave off does not leak into the next:

```ts
  settings.current = { ...DEFAULT_SETTINGS }
```

`beforeEach` does not reset it today (it only resets `recents.current` and clears mock calls).

- [ ] **Step 2: Write the failing App tests**

Append to `frontend/src/App.test.ts`:

```ts
describe('recovery drafts', () => {
  // vi.clearAllMocks in the top-level beforeEach clears calls, not
  // implementations, so a mockImplementation set by one test here would
  // leak into the next. Put the default back before each.
  beforeEach(() => {
    DocumentService.RecoverDraft.mockImplementation(async () => ({ found: false, content: '' }))
  })

  function recoverDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!
  }

  it('writes a draft shortly after typing into a dirty document', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    await vi.waitFor(() =>
      expect(DocumentService.WriteDraft).toHaveBeenCalledWith('/tmp/paper.md', 'x# Results\n'),
    )
  })

  it('discards the draft when the document is saved', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()
    await vi.waitFor(() => expect(DocumentService.WriteDraft).toHaveBeenCalled())

    listeners['menu:save']({ data: null })
    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith('/tmp/paper.md'))
  })

  it('writes nothing while Autosave is off', async () => {
    settings.current = { ...DEFAULT_SETTINGS, autoSave: false }
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    await new Promise((r) => setTimeout(r, 80)) // four debounce windows
    expect(DocumentService.WriteDraft).not.toHaveBeenCalled()
  })

  it('offers a newer draft on open, and Restore puts it in the editor as unsaved', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '/tmp/paper.md'
        ? { found: true, content: '# Results\n\nrecovered text\n' }
        : { found: false, content: '' },
    )
    const target = await openDoc('# Results\n')
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))
    expect(recoverDialog(target).getAttribute('role')).toBe('alertdialog')
    expect(target.textContent).toContain('A draft of "paper.md" newer than the file on disk was found')

    buttonByText(recoverDialog(target), 'Restore')!.click()
    flushSync()

    expect(recoverDialog(target).open).toBe(false)
    expect(target.textContent).toContain('recovered text')
    // The file on disk still holds the old text, so the document is dirty.
    expect(target.querySelector('.status-bar')!.textContent).toContain('•')
    expect(DocumentService.DiscardDraft).not.toHaveBeenCalled()
  })

  it('Discard Draft removes the draft and keeps the file as opened', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '/tmp/paper.md'
        ? { found: true, content: '# Results\n\nrecovered text\n' }
        : { found: false, content: '' },
    )
    const target = await openDoc('# Results\n\nOn disk.\n')
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    buttonByText(recoverDialog(target), 'Discard Draft')!.click()
    flushSync()

    expect(recoverDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith('/tmp/paper.md'))
    expect(target.textContent).toContain('On disk.')
    expect(target.textContent).not.toContain('recovered text')
    expect(target.querySelector('.status-bar')!.textContent).not.toContain('•')
  })

  it('offers an untitled draft at launch and restores it into an unsaved buffer', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n\nnever saved\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))
    expect(target.textContent).toContain('An unsaved untitled document was recovered from the last session')

    buttonByText(recoverDialog(target), 'Restore')!.click()
    flushSync()

    expect(target.textContent).toContain('never saved')
    expect(target.querySelector('.status-bar')!.textContent).toContain('Untitled •')
    expect(target.querySelector('.welcome')).toBeNull()
  })

  it('discarding the untitled draft on a first launch still opens the template', async () => {
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() => expect(recoverDialog(target).open).toBe(true))

    buttonByText(recoverDialog(target), 'Discard Draft')!.click()
    flushSync()

    await vi.waitFor(() => expect(DocumentService.DiscardDraft).toHaveBeenCalledWith(''))
    // No recents, so the first-launch template takes over as it always has.
    await vi.waitFor(() => expect(target.querySelector('.status-bar')!.textContent).toContain('Untitled'))
    expect(target.textContent).not.toContain('# Scratch')
  })

  it('waits for the draft queue before quitting after Save', async () => {
    const target = await openDoc('# Results\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    flushSync()

    listeners['close:confirm']({ data: null })
    flushSync()
    // Scoped to the dialog: the toolbar's own Save button comes first in
    // DOM order and would only save, never quit.
    const confirm = target.querySelector<HTMLElement>('dialog[aria-label="Unsaved changes"]')!
    buttonByText(confirm, 'Save')!.click()

    await vi.waitFor(() => expect(DocumentService.Quit).toHaveBeenCalled())
    const discardOrder = DocumentService.DiscardDraft.mock.invocationCallOrder[0]
    const quitOrder = DocumentService.Quit.mock.invocationCallOrder[0]
    expect(discardOrder).toBeLessThan(quitOrder)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `frontend/`: `npx vitest run src/App.test.ts -t 'recovery drafts'`
Expected: FAIL. `WriteDraft` never called; no dialog labelled "Recover draft".

- [ ] **Step 4: Wire `App.svelte`**

Imports, after the `debounce` import:

```ts
  import { createDraftKeeper, DRAFT_DEBOUNCE_MS } from './lib/recoveryDraft'
  import type { Draft } from '../bindings/hermes/models'
```

State, after `let showOutline = $state(false)`:

```ts
  let autoSave = $state(true)
  // A draft found on open (or the untitled one at launch), awaiting the
  // user's Restore / Discard Draft. Null when no dialog is up.
  let recovery = $state<{ content: string } | null>(null)
  // One toast per document for a failing draft write: a toast every two
  // seconds while typing would be worse than no insurance.
  let draftWriteWarned = false

  // The keeper decides when a draft is written and discarded; recovery.go
  // decides whether one is worth offering back. Go's own errors are
  // reported here, once, because the keeper swallows them by design.
  const drafts = createDraftKeeper(
    {
      write: (docPath, text) =>
        DocumentService.WriteDraft(docPath, text).catch((err) => {
          if (draftWriteWarned) return
          draftWriteWarned = true
          toast(`Could not write a recovery draft: ${err}`)
        }),
      discard: (docPath) =>
        DocumentService.DiscardDraft(docPath).catch((err) => console.warn('DiscardDraft:', err)),
    },
    DRAFT_DEBOUNCE_MS,
  )
```

The effect, directly after the existing `SetDirty` effect:

```ts
  // Every input the keeper cares about, in one place. `path ?? ''` is the
  // untitled key on the Go side.
  $effect(() => {
    drafts.update(path ?? '', content, dirty, autoSave)
  })
```

`refreshSettings`, after `showOutline = s.showOutline`:

```ts
    autoSave = s.autoSave
```

`loadDocument`: reset the keeper before the state changes, and ask for a draft at the end.

```ts
  function loadDocument(docPath: string, docContent: string, cursor: 'start' | 'end' = 'start') {
    // Before anything changes: the keeper must not read the swap from a
    // dirty old document to a clean new one as a save of the old one.
    drafts.reset()
    draftWriteWarned = false
    path = docPath
    content = docContent
    welcomeDismissed = true
    editor.setContent(docContent, cursor) // fires onEditorChange, queueing a render
    savedContent = docContent
    // Render now rather than 250 ms from now, and drop the queued pass: it
    // would only re-render this same text.
    updatePreview.cancel()
    renderInto(docContent)
    void refreshRecents()
    void offerDraft(docPath)
  }

  // Asks Go whether a draft is worth offering for docPath ('' for untitled)
  // and raises the dialog if so. Go has already dropped a draft the file has
  // caught up with, so found means newer and different. A failure to ask is
  // logged, not shown: the cost is one missed offer.
  async function offerDraft(docPath: string) {
    try {
      const draft: Draft = await DocumentService.RecoverDraft(docPath)
      if (!draft.found) return
      // The document may have been swapped again while we waited.
      if ((path ?? '') !== docPath) return
      recovery = { content: draft.content }
    } catch (err) {
      console.warn('RecoverDraft:', err)
    }
  }

  function restoreDraft() {
    const draft = recovery
    recovery = null
    if (!draft) return
    // savedContent is left as the file's text (or '' for untitled), so the
    // restored document is dirty: nothing on disk holds this text yet. The
    // draft file itself stays until the next clean transition — it is still
    // the only copy.
    editor.setContent(draft.content, 'start') // fires onEditorChange, queueing a render
    content = draft.content
    welcomeDismissed = true
    updatePreview.cancel()
    renderInto(draft.content)
  }

  function discardRecoveredDraft() {
    recovery = null
    void DocumentService.DiscardDraft(path ?? '').catch((err) => console.warn('DiscardDraft:', err))
    // A first launch with no recents goes to the template, as it would have
    // without a draft to ask about. Only the untitled path can be here with
    // an empty buffer.
    if (path === null && content === '' && recents.length === 0) doNew()
  }
```

`doNew`: add `drafts.reset()` and `draftWriteWarned = false` as its first two lines, for the same reason as `loadDocument`:

```ts
  function doNew() {
    drafts.reset()
    draftWriteWarned = false
    path = null
    ...
```

`confirmDiscard`: wait for the discard the clean transition queues before moving on, so a "Don't Save" then quit does not leave the draft to be offered next launch:

```ts
  async function confirmDiscard() {
    savedContent = content // treat current text as accepted; clears dirty
    await DocumentService.SetDirty(false)
    // The dirty effect above has queued the draft's discard by now; a quit
    // that follows must not outrun it.
    await drafts.settle()
    finishPending()
  }
```

`finishPending`: the quit branch waits for the queue, since `confirmSave` reaches here with the save's discard still queued:

```ts
    if (action === 'quit') void drafts.settle().then(() => DocumentService.Quit())
```

`onMount` startup block: check for an untitled draft before deciding on the template.

```ts
    void (async () => {
      await Promise.allSettled([refreshRecents(), refreshSettings()])
      // A crash with an untitled document leaves a draft under the
      // 'untitled' key; this is the one moment it can be offered. The
      // dialog's Discard Draft falls through to the template below when
      // there are no recents; Restore replaces it.
      await offerDraft('')
      if (recovery !== null) return
      // A first launch has nothing to put in the welcome pane, so go straight
      // into a templated document rather than an empty one — the user who has
      // never seen Hermes is exactly the one the template is for.
      if (recents.length === 0) doNew()
    })()
```

Template: after the unsaved-changes `Dialog` and before the toast:

```svelte
  <Dialog
    open={recovery !== null}
    label="Recover draft"
    role="alertdialog"
    onclose={discardRecoveredDraft}
  >
    {#if path === null}
      <p>An unsaved untitled document was recovered from the last session. Restore it?</p>
    {:else}
      <p>A draft of "{filename}" newer than the file on disk was found. Restore it?</p>
    {/if}
    {#snippet footer()}
      <button onclick={discardRecoveredDraft}>Discard Draft</button>
      <button class="primary" onclick={restoreDraft}>Restore</button>
    {/snippet}
  </Dialog>
```

Esc closes through `onclose`, which discards. That is deliberate: the alternative, leaving the draft and the dialog's question unanswered, would re-ask on every open.

- [ ] **Step 5: Run the App tests, then everything**

Run from `frontend/`: `npx vitest run src/App.test.ts -t 'recovery drafts'`
Expected: PASS, 8 tests.

Run from `frontend/`: `npx vitest run && npm run check`
Expected: all green. If an older test asserts an exact `DocumentService` call count that the new `RecoverDraft('')` at startup changes, adjust that assertion to the new count and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "feat: recovery drafts — written while dirty, offered back on open and at launch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Documentation, build, and the click-through

**Files:**
- Modify: `ROADMAP.md` (the Autosave item, `ROADMAP.md:685-709`)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)
- Modify: `README.md` (after step 3 of "Your first document", `README.md:138-139`)
- Modify: `CLAUDE.md` ("Other things to know")

- [ ] **Step 1: Tick the roadmap item**

Replace the item's first line and prepend a status sentence. Use a Python one-off with a uniqueness assertion, per the CLAUDE.md rule on editing `ROADMAP.md`:

```python
import pathlib
p = pathlib.Path('ROADMAP.md'); s = p.read_text()
old = "- [ ] Autosave. Nothing exists today: a document is written only on ⌘S,"
new = ("- [x] Autosave. Done 2026-09-01 as recovery drafts, unreleased: the\n"
       "      design in `docs/superpowers/specs/2026-09-01-recovery-drafts-design.md`,\n"
       "      the code in `recovery.go` and `lib/recoveryDraft.ts`. As proposed\n"
       "      below, with one addition: drafts older than 30 days are pruned at\n"
       "      launch, since a renamed or deleted document otherwise leaves one\n"
       "      behind forever. Original notes follow. Nothing existed before: a\n"
       "      document was written only on ⌘S,")
assert s.count(old) == 1
p.write_text(s.replace(old, new))
```

Then check the shape: `grep -c '^- \[' ROADMAP.md` is unchanged, and `grep '^## ' ROADMAP.md` is unchanged, compared with `git show HEAD:ROADMAP.md`.

- [ ] **Step 2: Changelog**

Add at the top of `### Added` under `## [Unreleased]`:

```markdown
- Recovery drafts. While a document has unsaved changes, Hermes writes a
  draft of it two seconds after you stop typing — beside its own settings,
  never over the document, so ⌘S is still the only thing that changes the
  file a co-author or a Pandoc run will see. If Hermes is quit without
  saving (a crash, a force-quit), the next time that document is opened it
  asks whether to restore the draft; an unsaved untitled document is
  offered back at the next launch. The draft is removed when the document
  is saved or its changes are discarded. View → Autosave turns it off.
```

- [ ] **Step 3: README**

After step 3 of "Your first document", add:

```markdown
   Hermes keeps a recovery draft while you have unsaved changes, written
   two seconds after you stop typing, so a crash loses at most that. The
   draft lives beside Hermes' settings, not over your file; the next time
   you open the document you are asked whether to restore it. **View →
   Autosave** turns this off.
```

- [ ] **Step 4: CLAUDE.md**

Add to "Other things to know", after the `Settings` bullet:

```markdown
- Recovery drafts are `recovery.go` (a `draftStore` under `<data>/hermes/drafts/`, keyed by a hash of the document path, `untitled` for none) behind `WriteDraft`/`DiscardDraft`/`RecoverDraft`, and `lib/recoveryDraft.ts` decides *when*: debounced 2 s while dirty and `autoSave` is on, discarded on the dirty-to-clean transition, both through one ordered queue so a discard cannot overtake a write in flight. `App.svelte` awaits `settle()` before quitting for the same reason. Go decides whether a draft is still worth offering (`find`: dropped if the document's mtime is at or after the draft's, or the texts match) — keep that rule in Go, so the frontend never compares files. A draft is never written over the document; explicit Save remains the act of record.
```

- [ ] **Step 5: Build, verify the binary, and hand over for the click-through**

Run from the repo root:

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
wails3 task build
strings "bin/Hermes Editor" | grep -c RecoverDraft
wails3 task run
```

Expected: the grep prints a non-zero count before `run`.

The agent cannot drive the native window (see memory). Ask the user to check:

1. Open a document, type, wait two seconds, and confirm a file appears under `~/Library/Application Support/hermes/drafts/`.
2. ⌘S: the draft file disappears.
3. Type again, wait two seconds, then force-quit (`kill -9` the process). Relaunch, open the same document from Open Recent: the "Recover draft" dialog appears; Restore shows the typed text with the • dirty mark; ⌘S clears the draft.
4. Same, but choose Discard Draft: the file's content stays and the draft file is gone.
5. Type into an untitled document, force-quit, relaunch: the untitled dialog appears before the welcome pane or template.
6. View → Autosave off: typing writes no draft; the checkbox state survives a relaunch.
7. ⌘Q with unsaved changes → Save: no draft left in the folder afterwards. Same with Don't Save.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md CHANGELOG.md README.md CLAUDE.md
git commit -m "docs: recovery drafts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: storage and key (Task 2), write timing and the setting gate (Tasks 4, 5), removal on clean transition and before quit (Tasks 4, 5), supersede rules in Go (Task 2), pruning (Task 2), dialog copy and behaviour (Task 5), setting default and the absent-key fix (Task 1), menu (Task 3), failure reporting (Task 5), docs (Task 6).
- Known gap, accepted in the spec: no maximum-wait floor on the debounce. A continuous burst of typing with no two-second pause writes nothing until it pauses.
- Not covered by a test: the menu checkbox itself. `menu.go` has no structural tests today and the click-through covers it.
- Type consistency: `Draft` is `{ Found bool; Content string }` in Go and `{ found: boolean; content: string }` in TS, both from the generated bindings. `createDraftKeeper(sink, wait)` and `DraftKeeper.update(docPath, content, dirty, enabled)` are the same in Task 4's tests, its implementation, and Task 5's wiring.
