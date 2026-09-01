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
