### Task 6: Go — ReadBibliography + watcher

**Files:**
- Modify: `documentservice.go`, `documentservice_test.go`

**Interfaces:**
- Produces (bindings used in Task 8): `ReadBibliography(path, docPath string) (string, error)`; `WatchBibliography(path, docPath string)` (empty `path` stops watching). Internal: `watchTick time.Duration` field (default `2 * time.Second`), `emitBibChanged func()` field (defaults to Wails emit, injectable in tests), `watchCancel context.CancelFunc` + `watchMu sync.Mutex`.
- Event emitted: `bib:changed` (no payload).

- [ ] **Step 1: Write the failing tests** (append to `documentservice_test.go`)

```go
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
```
(New imports in the test file: `"sync/atomic"`, `"time"`.)

- [ ] **Step 2: Run to verify FAIL** (`go test ./. -run 'TestReadBibliography|TestWatchBibliography'`), then implement in `documentservice.go`:

Struct additions:
```go
	watchTick      time.Duration
	emitBibChanged func()
	watchMu        sync.Mutex
	watchCancel    context.CancelFunc
```
`NewDocumentService` sets `watchTick: 2 * time.Second`.

```go
func (s *DocumentService) resolveAgainstDoc(path, docPath string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(docPath), path)
}

func (s *DocumentService) ReadBibliography(path, docPath string) (string, error) {
	data, err := os.ReadFile(s.resolveAgainstDoc(path, docPath))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WatchBibliography (re)arms the single bibliography watcher. An empty path
// stops watching. The goroutine polls mtime+size and notifies on change; a
// missing file keeps polling and notifies when it appears.
func (s *DocumentService) WatchBibliography(path, docPath string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if s.watchCancel != nil {
		s.watchCancel()
		s.watchCancel = nil
	}
	if path == "" {
		return
	}
	resolved := s.resolveAgainstDoc(path, docPath)
	ctx, cancel := context.WithCancel(context.Background())
	s.watchCancel = cancel

	notify := s.emitBibChanged
	if notify == nil {
		notify = func() { application.Get().Event.Emit("bib:changed") }
	}

	go func() {
		var lastMod time.Time
		var lastSize int64
		known := false
		if info, err := os.Stat(resolved); err == nil {
			lastMod, lastSize, known = info.ModTime(), info.Size(), true
		}
		ticker := time.NewTicker(s.watchTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				info, err := os.Stat(resolved)
				if err != nil {
					known = false
					continue
				}
				if !known || !info.ModTime().Equal(lastMod) || info.Size() != lastSize {
					lastMod, lastSize, known = info.ModTime(), info.Size(), true
					notify()
				}
			}
		}
	}()
}
```
Wait — the initial-stat logic marks an existing file as `known`, so the first tick only notifies on change; a file appearing later (`!known`) notifies immediately. That matches both tests. New imports: `"context"`, `"sync"`, `"time"`.

- [ ] **Step 3: Run to verify PASS** (all Go tests), `gofmt -l documentservice.go` clean, `go build -o /dev/null .`.

- [ ] **Step 4: Commit** — `git commit -m "feat: bibliography read and mtime watcher with bib:changed event"`

---

