### Task 7: Go — CAYW picker + menu item + bindings

**Files:**
- Create: `zotero.go`, `zotero_test.go`
- Modify: `menu.go`, `documentservice.go` (delegate method), `frontend/bindings` (regenerated)

**Interfaces:**
- Produces: binding `PickCitations() (string, error)` on DocumentService — returns the Pandoc-format string from CAYW ("" when the user cancels); error when Zotero/BBT is unreachable. Internal: `caywBase string` field on DocumentService (default `http://127.0.0.1:23119`), injectable for tests. Menu: File → Insert Citation… (`cmdorctrl+shift+c`) emitting `menu:insert-citation` (no payload).

- [ ] **Step 1: Write the failing tests** (`zotero_test.go`)

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPickCitationsReturnsCAYWResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/better-bibtex/cayw" || r.URL.Query().Get("format") != "pandoc" {
			t.Errorf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte("[@smith2020; @doe2021]"))
	}))
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if got != "[@smith2020; @doe2021]" {
		t.Errorf("got %q", got)
	}
}

func TestPickCitationsEmptyOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("")) // CAYW returns empty on cancel
	}))
	defer srv.Close()
	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil || got != "" {
		t.Errorf("want empty no-error, got %q err %v", got, err)
	}
}

func TestPickCitationsErrorWhenUnreachable(t *testing.T) {
	s := newTestService(t)
	s.caywBase = "http://127.0.0.1:1" // nothing listens here
	if _, err := s.PickCitations(); err == nil {
		t.Error("want error when Zotero is unreachable")
	}
}
```

- [ ] **Step 2: Run to verify FAIL**, then implement `zotero.go`:

```go
package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// PickCitations opens Zotero's citation picker via Better BibTeX's CAYW
// endpoint and returns the chosen citations in Pandoc format. The timeout is
// long because the user is interacting with the picker; an empty response
// means they cancelled.
func (s *DocumentService) PickCitations() (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(s.caywBase + "/better-bibtex/cayw?format=pandoc")
	if err != nil {
		return "", fmt.Errorf("zotero picker unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("zotero picker returned %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
```
Add `caywBase string` to the DocumentService struct; `NewDocumentService` sets `caywBase: "http://127.0.0.1:23119"`.

- [ ] **Step 3: Menu item** (`menu.go`, in the File submenu after "Open Recent" — before Save):

```go
	file.Add("Insert Citation…").SetAccelerator("shift+cmdorctrl+c").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-citation")
	})
```

- [ ] **Step 4: Gates + bindings** — `go test ./.` all green, `gofmt -l` clean, `go build -o /dev/null .`, then `wails3 task common:generate:bindings`; confirm `PickCitations`, `ReadBibliography`, `WatchBibliography` appear in `frontend/bindings/hermes/documentservice.ts`.

- [ ] **Step 5: Commit** — `git add zotero.go zotero_test.go menu.go documentservice.go frontend/bindings && git commit -m "feat: Zotero CAYW picker binding and Insert Citation menu item"`

---

