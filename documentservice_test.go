package main

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newTestService(t *testing.T) *DocumentService {
	t.Helper()
	return NewDocumentService(filepath.Join(t.TempDir(), "recents.json"))
}

func TestSaveAndOpenPathRoundTrip(t *testing.T) {
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "paper.md")

	if err := s.Save(path, "# Title\n$x^2$\n"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	doc, err := s.OpenPath(path)
	if err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	if doc.Path != path || doc.Content != "# Title\n$x^2$\n" {
		t.Errorf("got %+v", doc)
	}
}

func TestOpenPathMissingFile(t *testing.T) {
	s := newTestService(t)
	if _, err := s.OpenPath(filepath.Join(t.TempDir(), "nope.md")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestRecentsOrderDedupeAndCap(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()

	var paths []string
	for i := range 12 {
		p := filepath.Join(dir, string(rune('a'+i))+".md")
		if err := s.Save(p, "x"); err != nil {
			t.Fatalf("Save: %v", err)
		}
		paths = append(paths, p)
	}
	// re-open an old file: it must move to the front, not duplicate
	if _, err := s.OpenPath(paths[5]); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}

	recents := s.RecentFiles()
	if len(recents) != 10 {
		t.Fatalf("want 10 recents, got %d", len(recents))
	}
	if recents[0] != paths[5] {
		t.Errorf("want %s first, got %s", paths[5], recents[0])
	}
	count := 0
	for _, r := range recents {
		if r == paths[5] {
			count++
		}
	}
	if count != 1 {
		t.Errorf("path duplicated %d times in recents", count)
	}
	if slices.Contains(recents, paths[0]) {
		t.Error("oldest entry should have been evicted")
	}
}

func TestRecentsCorruptFileReturnsEmpty(t *testing.T) {
	s := newTestService(t)
	if err := os.MkdirAll(filepath.Dir(s.recentsPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.recentsPath, []byte("{corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := s.RecentFiles(); len(got) != 0 {
		t.Errorf("want empty recents, got %v", got)
	}
}

func TestDirtyFlag(t *testing.T) {
	s := newTestService(t)
	if s.IsDirty() {
		t.Error("new service should not be dirty")
	}
	s.SetDirty(true)
	if !s.IsDirty() {
		t.Error("should be dirty after SetDirty(true)")
	}
	path := filepath.Join(t.TempDir(), "p.md")
	if err := s.Save(path, "x"); err != nil {
		t.Fatal(err)
	}
	if s.IsDirty() {
		t.Error("Save should clear dirty")
	}
}

func TestClearRecents(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	for _, name := range []string{"a.md", "b.md"} {
		if err := s.Save(filepath.Join(dir, name), "x"); err != nil {
			t.Fatalf("Save: %v", err)
		}
	}
	if len(s.RecentFiles()) != 2 {
		t.Fatal("precondition: expected 2 recents")
	}

	s.ClearRecents()

	if got := s.RecentFiles(); len(got) != 0 {
		t.Errorf("want no recents after clear, got %v", got)
	}
}

func TestRecentsChangedCallback(t *testing.T) {
	s := newTestService(t)
	fired := 0
	s.onRecentsChanged = func() { fired++ }
	dir := t.TempDir()

	path := filepath.Join(dir, "a.md")
	if err := s.Save(path, "x"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if fired != 1 {
		t.Errorf("want callback after Save, fired=%d", fired)
	}

	if _, err := s.OpenPath(path); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	if fired != 2 {
		t.Errorf("want callback after OpenPath, fired=%d", fired)
	}

	s.ClearRecents()
	if fired != 3 {
		t.Errorf("want callback after ClearRecents, fired=%d", fired)
	}
}

func TestReadBibliographyResolvesRelativeToDocument(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	bibPath := filepath.Join(dir, "refs.bib")
	if err := os.WriteFile(bibPath, []byte("@article{x, year={2020}}"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := s.ReadBibliography("refs.bib", docPath)
	if err != nil {
		t.Fatalf("relative read: %v", err)
	}
	if got != "@article{x, year={2020}}" {
		t.Errorf("unexpected content %q", got)
	}

	got, err = s.ReadBibliography(bibPath, docPath) // absolute passes through
	if err != nil || got == "" {
		t.Errorf("absolute read failed: %v", err)
	}

	if _, err := s.ReadBibliography("missing.bib", docPath); err == nil {
		t.Error("want error for missing bibliography")
	}
}

func TestWatchBibliographyEmitsOnChange(t *testing.T) {
	s := newTestService(t)
	s.watchTick = 10 * time.Millisecond
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	bibPath := filepath.Join(dir, "refs.bib")
	if err := os.WriteFile(bibPath, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	var emitted atomic.Int32
	s.emitBibChanged = func() { emitted.Add(1) }

	s.WatchBibliography("refs.bib", docPath)
	time.Sleep(30 * time.Millisecond) // no change yet
	if emitted.Load() != 0 {
		t.Fatalf("emitted %d before any change", emitted.Load())
	}

	// mtime resolution can be coarse; change size too
	if err := os.WriteFile(bibPath, []byte("v2 longer"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for emitted.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if emitted.Load() == 0 {
		t.Fatal("no emit after change")
	}

	s.WatchBibliography("", docPath) // stop
}

func TestWatchBibliographySelfHealsMissingFile(t *testing.T) {
	s := newTestService(t)
	s.watchTick = 10 * time.Millisecond
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	var emitted atomic.Int32
	s.emitBibChanged = func() { emitted.Add(1) }

	s.WatchBibliography("refs.bib", docPath) // file doesn't exist yet
	time.Sleep(30 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(dir, "refs.bib"), []byte("now"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for emitted.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if emitted.Load() == 0 {
		t.Fatal("no emit when file appeared")
	}
	s.WatchBibliography("", docPath)
}

func TestAddRecentSurvivesConcurrentSaves(t *testing.T) {
	// Wails runs each binding call on its own goroutine, so two saves can
	// overlap. addRecent reads the file, edits the list, and writes it back;
	// without serialisation the later write clobbers the earlier one and
	// entries go missing.
	s := newTestService(t)
	dir := t.TempDir()

	var wg sync.WaitGroup
	for i := range 20 {
		wg.Go(func() {
			if err := s.Save(filepath.Join(dir, fmt.Sprintf("f%02d.md", i)), "x"); err != nil {
				t.Errorf("Save: %v", err)
			}
		})
	}
	wg.Wait()

	recents := s.RecentFiles()
	if len(recents) != maxRecents {
		t.Errorf("want a full list of %d recents, got %d: %v", maxRecents, len(recents), recents)
	}
	seen := map[string]bool{}
	for _, r := range recents {
		if seen[r] {
			t.Errorf("duplicate entry %q in %v", r, recents)
		}
		seen[r] = true
	}
}
