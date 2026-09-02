# Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hermes can tell the user a newer version exists by fetching a static version file once a day at most, sending nothing identifying, and opening the release page in the browser on request; asked once at first launch, toggled from the Help menu.

**Architecture:** `update.go` owns the check (strict version compare, a throttled HTTPS GET of `updates/latest.json` from the repo, a derived release URL) behind one `DocumentService.CheckForUpdates(force)` binding, with the feed URL, state path, clock and version reader injectable the way `caywBase` is. A three-state `UpdateCheck` setting gates it. `menu.go` adds Help → Check for Updates… (an event) and a Check Automatically checkbox. `App.svelte` asks once at first launch, runs the automatic check after the recovery-draft offer, and shows an "Update available" dialog whose primary button opens the URL with `Browser.OpenURL`. The release task refuses to run unless the feed matches `build/config.yml`.

**Tech Stack:** Go 1.25 (`net/http`, `httptest`), Wails v3 beta.12 bindings, Svelte 5 runes, TypeScript, Vitest + jsdom, Taskfile.

**Spec:** `docs/superpowers/specs/2026-09-02-update-check-design.md`

## Global Constraints

- Go: `go test ./. && go build -o /dev/null .` from the repo root. Use `.`, not `./...`. The linker prints pre-existing `ld: warning: object file ... built for newer 'macOS' version` lines; ignore them.
- Frontend commands run from `frontend/`: `npx vitest run <file>`, `npx vitest run`, `npm run check`.
- Never hand-edit `frontend/bindings/`. Task 3 regenerates them with `wails3 task common:generate:bindings`.
- No literal colours in CSS. This plan adds no CSS.
- Tests never touch the network: every HTTP test uses `httptest.NewServer` and sets `s.updateFeed = srv.URL`.
- `wails3 task run` does not build. The real-app check is `wails3 task build && wails3 task run`; confirm first that `strings "bin/Hermes Editor" | grep -c CheckForUpdates` is non-zero.
- Commit after each task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on a branch `update-check` off `main`.
- Copy, exactly: setting key `updateCheck` with values `unasked`/`on`/`off`; menu items `Check for Updates…` and `Check for Updates Automatically`; event `menu:check-updates`; dialog labels `Check for updates` and `Update available`; buttons `Don't Check`, `Check Automatically`, `Later`, `View Release`; texts and toasts exactly as written in Task 4.
- Constants: feed `https://raw.githubusercontent.com/richarc/hermes/main/updates/latest.json`; releases base `https://github.com/richarc/hermes/releases`; interval 24 h; body limit 4 KB; HTTP timeout 10 s.
- Editing `ROADMAP.md`: `str.replace` with `assert s.count(old) == 1`, then `grep -c '^- \['` unchanged and `grep '^## '` unchanged.

---

## File structure

| File | Responsibility |
|---|---|
| `settings.go`, `settings_test.go` | `UpdateCheck` three-state field, default `unasked`, clamp. |
| `update.go` (new) | Constants, `UpdateResult`, `compareVersions`, `parseUpdateFeed`, throttle state, `CheckForUpdates`. |
| `update_test.go` (new) | Compare table, feed parsing, throttle, HTTP paths via `httptest`, privacy assertions. |
| `documentservice.go` | Four injectable fields and their defaults in the constructor. |
| `updates/latest.json` (new) | The feed, `{"version": "0.9.0"}` (the last published release). |
| `Taskfile.yml` | `release` precondition: feed version equals `config.yml` version. |
| `menu.go` | Help → Check for Updates… and the Check Automatically checkbox. |
| `frontend/bindings/hermes/*` | Regenerated. |
| `frontend/src/App.svelte` | Setting state, first-launch ask, automatic check, manual check, two dialogs. |
| `frontend/src/App.test.ts` | Ask/decline/accept, automatic and manual checks, dialog, toasts, refusal, recovery-first ordering. |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `ROADMAP.md` | Docs. |

---

### Task 1: The `UpdateCheck` setting

**Files:**
- Modify: `settings.go`
- Modify: `settings_test.go`

**Interfaces:**
- Produces: `Settings.UpdateCheck string` (JSON `updateCheck`), values `"unasked"`, `"on"`, `"off"`, default `"unasked"`. Read by `menu.go` (Task 3) and as `s.updateCheck` in TS (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `settings_test.go`:

```go
func TestUpdateCheckDefaultsToUnasked(t *testing.T) {
	if got := newTestService(t).Settings().UpdateCheck; got != "unasked" {
		t.Errorf("want unasked, got %q", got)
	}
}

func TestUpdateCheckPersistsAndClamps(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)
	for _, v := range []string{"on", "off"} {
		next := s.Settings()
		next.UpdateCheck = v
		if err := s.UpdateSettings(next); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", v, err)
		}
		if got := NewDocumentService(recentsPath).Settings().UpdateCheck; got != v {
			t.Errorf("want %q persisted, got %q", v, got)
		}
	}
	// Anything else is not a state the app can act on.
	next := s.Settings()
	next.UpdateCheck = "sometimes"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if got := s.Settings().UpdateCheck; got != "unasked" {
		t.Errorf("an unknown value must clamp to unasked, got %q", got)
	}
}

// A settings file from before the field existed has no updateCheck key; the
// loader unmarshals over the defaults, so it reads as unasked and the user
// is asked once, as a fresh install would be.
func TestSettingsFileWithoutUpdateCheckKeyReadsAsUnasked(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"autoSave":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := NewDocumentService(filepath.Join(dir, "recents.json")).Settings()
	if got.UpdateCheck != "unasked" || got.AutoSave {
		t.Errorf("want unasked with autoSave still false, got %+v", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./. -run 'UpdateCheck' -v`
Expected: compile error, `UpdateCheck undefined`.

- [ ] **Step 3: Add the field, default and clamp**

In `settings.go`, add to the struct after `AutoSave`:

```go
	// Whether Hermes may fetch the version feed: "unasked" until the first
	// launch has put the question, then "on" or "off". See update.go.
	UpdateCheck string `json:"updateCheck"`
```

In `defaultSettings`, after `AutoSave: true,`:

```go
		UpdateCheck:      "unasked",
```

In `normalise`, after the `PaperSize` clause:

```go
	if s.UpdateCheck != "unasked" && s.UpdateCheck != "on" && s.UpdateCheck != "off" {
		s.UpdateCheck = defaultSettings().UpdateCheck
	}
```

- [ ] **Step 4: Run the Go tests**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add settings.go settings_test.go
git commit -m "feat: an UpdateCheck setting — unasked, on or off

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `update.go`, the check

**Files:**
- Create: `update.go`
- Create: `update_test.go`
- Modify: `documentservice.go` (struct fields and constructor)

**Interfaces:**
- Consumes: `writeFileAtomic` (`atomicwrite.go`), `appVersion()` (`version_darwin.go`/`version_other.go`), `newTestService(t)` (`documentservice_test.go`).
- Produces:
  ```go
  const updateFeedURL, releasesBaseURL string; const updateCheckInterval time.Duration
  type UpdateResult struct { Checked, Available bool; Current, Latest, URL string }
  func compareVersions(a, b string) (int, error)
  func parseUpdateFeed(body []byte) (string, error)
  func releaseURL(version string) string
  func (s *DocumentService) CheckForUpdates(force bool) (UpdateResult, error)
  ```
  and on `DocumentService`: `updateFeed string`, `updateStatePath string`, `now func() time.Time`, `version func() string`.

- [ ] **Step 1: Write the failing tests**

Create `update_test.go`:

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want int
	}{
		{"0.9.0", "0.10.0", -1},
		{"0.10.0", "0.9.0", 1},
		{"1.0.0", "1.0.0", 0},
		{"v1.2.3", "1.2.3", 0},
		{"1.2.3", "1.2.10", -1},
		{"1.9.9", "2.0.0", -1},
	} {
		got, err := compareVersions(tc.a, tc.b)
		if err != nil {
			t.Errorf("compareVersions(%q, %q): %v", tc.a, tc.b, err)
			continue
		}
		if got != tc.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestCompareVersionsRejectsMalformed(t *testing.T) {
	for _, bad := range []string{"", "1.2", "1.2.3.4", "1.2.x", "1.2.3-beta", "latest", " 1.2.3"} {
		if _, err := compareVersions(bad, "1.0.0"); err == nil {
			t.Errorf("want an error for %q", bad)
		}
	}
}

func TestParseUpdateFeed(t *testing.T) {
	got, err := parseUpdateFeed([]byte(`{"version": "0.10.0"}`))
	if err != nil || got != "0.10.0" {
		t.Errorf("got %q, %v", got, err)
	}
	for _, bad := range []string{`{}`, `{"version": ""}`, `{"version": "0.10"}`, `{"version": "../x"}`, `not json`, `{"version": "0.10.0", "url": "https://evil"}`} {
		if _, err := parseUpdateFeed([]byte(bad)); err == nil {
			t.Errorf("want an error for %s", bad)
		}
	}
}

// The release page is derived from the validated version, never read from
// the feed: a tampered file can change a number, not a destination.
func TestReleaseURL(t *testing.T) {
	if got := releaseURL("0.10.0"); got != "https://github.com/richarc/hermes/releases/tag/v0.10.0" {
		t.Errorf("got %q", got)
	}
}

// A service wired to a fake feed, with a fixed clock and version.
func newUpdateTestService(t *testing.T, feedBody string, status int) (*DocumentService, *int, *http.Request) {
	t.Helper()
	hits := 0
	var last http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		last = *r
		w.WriteHeader(status)
		_, _ = w.Write([]byte(feedBody))
	}))
	t.Cleanup(srv.Close)
	s := newTestService(t)
	s.updateFeed = srv.URL
	s.version = func() string { return "0.9.0" }
	s.now = func() time.Time { return time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC) }
	return s, &hits, &last
}

func TestCheckForUpdatesFindsANewerVersion(t *testing.T) {
	s, _, _ := newUpdateTestService(t, `{"version": "0.10.0"}`, http.StatusOK)
	got, err := s.CheckForUpdates(false)
	if err != nil {
		t.Fatal(err)
	}
	want := UpdateResult{Checked: true, Available: true, Current: "0.9.0", Latest: "0.10.0",
		URL: "https://github.com/richarc/hermes/releases/tag/v0.10.0"}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestCheckForUpdatesUpToDate(t *testing.T) {
	s, _, _ := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	got, err := s.CheckForUpdates(false)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Checked || got.Available || got.Latest != "0.9.0" {
		t.Errorf("got %+v", got)
	}
}

// The privacy promise, asserted: the same bare URL every time, no query
// string, and nothing in the request that says which version is asking.
func TestCheckForUpdatesSendsNothingIdentifying(t *testing.T) {
	s, _, last := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	if last.URL.RawQuery != "" {
		t.Errorf("query string must be empty, got %q", last.URL.RawQuery)
	}
	if last.URL.Path != "/" && !strings.HasSuffix(last.URL.Path, "latest.json") {
		t.Errorf("unexpected path %q", last.URL.Path)
	}
	for name, values := range last.Header {
		for _, v := range values {
			if strings.Contains(v, "0.9.0") {
				t.Errorf("header %s carries the installed version: %q", name, v)
			}
		}
	}
}

func TestCheckForUpdatesThrottlesToOnceADay(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	// Same day: nothing fetched, and the result says so.
	got, err := s.CheckForUpdates(false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Checked || *hits != 1 {
		t.Errorf("second check within a day must not fetch: %+v, hits=%d", got, *hits)
	}
	if got.Current != "0.9.0" {
		t.Errorf("a throttled result still reports the current version, got %+v", got)
	}
	// A manual check ignores the throttle.
	if _, err := s.CheckForUpdates(true); err != nil {
		t.Fatal(err)
	}
	if *hits != 2 {
		t.Errorf("force must fetch, hits=%d", *hits)
	}
	// A day later it fetches again.
	s.now = func() time.Time { return time.Date(2026, 9, 3, 9, 0, 1, 0, time.UTC) }
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	if *hits != 3 {
		t.Errorf("after the interval it must fetch, hits=%d", *hits)
	}
}

// The throttle survives a relaunch: it is a file beside the settings, not a
// field in memory.
func TestCheckForUpdatesThrottlePersists(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	wantState := filepath.Join(filepath.Dir(s.recentsPath), "update-check.json")
	if _, err := os.Stat(wantState); err != nil {
		t.Fatalf("want the state file at %s: %v", wantState, err)
	}
	again := NewDocumentService(s.recentsPath)
	again.updateFeed, again.version, again.now = s.updateFeed, s.version, s.now
	got, err := again.CheckForUpdates(false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Checked || *hits != 1 {
		t.Errorf("a fresh service must honour the recorded check: %+v, hits=%d", got, *hits)
	}
}

// A failed attempt is still an attempt: an offline machine is not asked
// again on every launch that day.
func TestCheckForUpdatesRecordsAFailedAttempt(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `nope`, http.StatusInternalServerError)
	if _, err := s.CheckForUpdates(false); err == nil {
		t.Fatal("want an error on a 500")
	}
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatalf("a throttled call must not error: %v", err)
	}
	if *hits != 1 {
		t.Errorf("the failed attempt must count, hits=%d", *hits)
	}
}

func TestCheckForUpdatesErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		body   string
		status int
	}{
		{"not found", "", http.StatusNotFound},
		{"malformed json", "{", http.StatusOK},
		{"bad version", `{"version": "soon"}`, http.StatusOK},
		{"oversized", strings.Repeat("x", 5<<10), http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := newUpdateTestService(t, tc.body, tc.status)
			if _, err := s.CheckForUpdates(true); err == nil {
				t.Error("want an error")
			}
		})
	}
}

func TestCheckForUpdatesUnreachable(t *testing.T) {
	s := newTestService(t)
	s.updateFeed = "http://127.0.0.1:1"
	s.version = func() string { return "0.9.0" }
	if _, err := s.CheckForUpdates(true); err == nil {
		t.Error("want an error when the feed is unreachable")
	}
}

// An unbundled binary has no version to compare; say so rather than
// comparing against an empty string and announcing every release as new.
func TestCheckForUpdatesWithoutAVersion(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `{"version": "0.10.0"}`, http.StatusOK)
	s.version = func() string { return "" }
	if _, err := s.CheckForUpdates(true); err == nil {
		t.Error("want an error")
	}
	if *hits != 0 {
		t.Error("nothing should be fetched without a version to compare")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./. -run 'Version|UpdateFeed|ReleaseURL|CheckForUpdates' -v`
Expected: compile errors for `compareVersions`, `UpdateResult`, `s.updateFeed`.

- [ ] **Step 3: Write `update.go`**

```go
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Where the version feed lives and what it points at. A file in this
// repository rather than the Releases API: static, no rate limit, and it
// carries nothing but a version. When the documentation site ships the feed
// moves there; nothing else assumes where it is.
const (
	updateFeedURL       = "https://raw.githubusercontent.com/richarc/hermes/main/updates/latest.json"
	releasesBaseURL     = "https://github.com/richarc/hermes/releases"
	updateCheckInterval = 24 * time.Hour
	updateFetchTimeout  = 10 * time.Second
	// The feed is one short line. A body larger than this is not the feed.
	maxUpdateFeedBytes = 4 << 10
)

// UpdateResult is what CheckForUpdates hands the frontend. Checked false
// means the throttle applied and nothing was fetched; Current is filled
// either way so a manual "up to date" message can name the version.
type UpdateResult struct {
	Checked   bool   `json:"checked"`
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	URL       string `json:"url"`
}

// updateState is the throttle: when the feed was last asked, whether or not
// the answer was usable. Kept in its own file rather than in Settings so a
// daily timestamp does not rebuild the menu and notify the frontend.
type updateState struct {
	CheckedAt time.Time `json:"checkedAt"`
}

// Exactly three numeric parts, an optional leading v (tags carry one,
// config.yml does not). No pre-release or build suffixes: Hermes has never
// shipped one, and accepting them would mean defining an order for them.
var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// compareVersions reports -1, 0 or 1 as a is older than, equal to, or newer
// than b. Either side failing to parse is an error rather than a guess.
func compareVersions(a, b string) (int, error) {
	pa, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	pb, err := parseVersion(b)
	if err != nil {
		return 0, err
	}
	for i := range pa {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	return 0, nil
}

func parseVersion(v string) ([3]int, error) {
	var parts [3]int
	m := versionPattern.FindStringSubmatch(v)
	if m == nil {
		return parts, fmt.Errorf("not a version: %q", v)
	}
	for i := range parts {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return parts, err
		}
		parts[i] = n
	}
	return parts, nil
}

// parseUpdateFeed reads the version out of the feed body and validates it.
// Strict on purpose: the version is about to become part of a URL, and
// anything the pattern rejects never gets that far. Unknown keys are refused
// too — the feed has exactly one field, and a second one is a sign of a file
// that is not ours.
func parseUpdateFeed(body []byte) (string, error) {
	var feed struct {
		Version string `json:"version"`
	}
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&feed); err != nil {
		return "", fmt.Errorf("the version feed could not be read: %w", err)
	}
	if !versionPattern.MatchString(feed.Version) || strings.HasPrefix(feed.Version, "v") {
		return "", fmt.Errorf("the version feed carries an unusable version %q", feed.Version)
	}
	return feed.Version, nil
}

// releaseURL is the release page for a version that parseUpdateFeed has
// already validated. Derived, never read from the feed.
func releaseURL(version string) string {
	return releasesBaseURL + "/tag/v" + version
}

// CheckForUpdates compares the running version with the feed's. force skips
// the once-a-day throttle; the Help menu's manual item passes true, the
// automatic check at launch passes false.
//
// The privacy rules are all here: the request is the same bare URL every
// time with no query string and no custom header, and it happens at most
// once per interval. Nothing about the installation travels.
func (s *DocumentService) CheckForUpdates(force bool) (UpdateResult, error) {
	current := s.version()
	if current == "" {
		return UpdateResult{}, errors.New("this build has no version to compare")
	}
	result := UpdateResult{Current: current}

	now := s.now()
	if !force {
		if state, err := s.readUpdateState(); err == nil && now.Sub(state.CheckedAt) < updateCheckInterval {
			return result, nil
		}
	}
	// Recorded before the fetch, so a machine that cannot reach the feed is
	// not asked again on every launch that day.
	if err := s.writeUpdateState(updateState{CheckedAt: now}); err != nil {
		return result, err
	}

	latest, err := s.fetchLatestVersion()
	if err != nil {
		return result, err
	}
	cmp, err := compareVersions(current, latest)
	if err != nil {
		return result, err
	}
	result.Checked = true
	result.Latest = latest
	result.URL = releaseURL(latest)
	result.Available = cmp < 0
	return result, nil
}

func (s *DocumentService) fetchLatestVersion() (string, error) {
	client := &http.Client{Timeout: updateFetchTimeout}
	resp, err := client.Get(s.updateFeed)
	if err != nil {
		return "", fmt.Errorf("the version feed could not be reached: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the version feed returned %s", resp.Status)
	}
	// One byte over the limit is read so an oversized body is detected
	// rather than silently truncated into something that might parse.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateFeedBytes+1))
	if err != nil {
		return "", err
	}
	if len(body) > maxUpdateFeedBytes {
		return "", errors.New("the version feed is larger than a version feed should be")
	}
	return parseUpdateFeed(body)
}

func (s *DocumentService) readUpdateState() (updateState, error) {
	var state updateState
	data, err := os.ReadFile(s.updateStatePath)
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(data, &state)
	return state, err
}

func (s *DocumentService) writeUpdateState(state updateState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return writeFileAtomic(s.updateStatePath, data, 0o644)
}
```

- [ ] **Step 4: Wire the fields into `DocumentService`**

In `documentservice.go`, add to the struct after `caywBase string`:

```go
	// The update check's inputs, injectable so the tests can point it at an
	// httptest server with a fixed clock and version. See update.go.
	updateFeed      string
	updateStatePath string
	now             func() time.Time
	version         func() string
```

In `NewDocumentService`, after `caywBase:`:

```go
		updateFeed:      updateFeedURL,
		updateStatePath: filepath.Join(dataDir, "update-check.json"),
		now:             time.Now,
		version:         appVersion,
```

(`dataDir` already exists in the constructor from the recovery-drafts work.)

- [ ] **Step 5: Run the Go tests**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add update.go update_test.go documentservice.go
git commit -m "feat: a throttled, identity-free update check against a static version feed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The feed file, the release guard, the Help menu, and the bindings

**Files:**
- Create: `updates/latest.json`
- Modify: `Taskfile.yml` (the `release` task's `preconditions`)
- Modify: `menu.go` (Help menu, between Licences and Report an Issue…)
- Regenerate: `frontend/bindings/hermes/*`

**Interfaces:**
- Consumes: `Settings.UpdateCheck` (Task 1), `CheckForUpdates` and `UpdateResult` (Task 2).
- Produces: event `menu:check-updates` (payloadless); TS `DocumentService.CheckForUpdates(force: boolean): Promise<UpdateResult>`, `interface UpdateResult { checked; available; current; latest; url }`, `Settings.updateCheck: string`.

- [ ] **Step 1: The feed file**

Create `updates/latest.json` with exactly:

```json
{"version": "0.9.0"}
```

(`0.9.0` is the last published release, `build/config.yml`'s current `version`. The feed names what can be downloaded today, not what is being built.)

- [ ] **Step 2: The release precondition**

In `Taskfile.yml`, inside the `release` task's `preconditions:` list (after the existing `security find-identity` entry), add:

```yaml
      # The feed the app checks against must name the version being cut, or
      # the release ships and nobody is told. Bumped in the same commit as
      # config.yml; README's release steps push main only after the GitHub
      # release is published, so the feed never announces a version that
      # cannot be downloaded yet.
      - sh: 'grep -q "\"version\": \"{{.VERSION}}\"" updates/latest.json'
        msg: |
          updates/latest.json does not name {{.VERSION}}. Bump it alongside
          build/config.yml before cutting a release — see README, Cutting a
          release.
```

Check the YAML parses: `wails3 task --list >/dev/null && echo ok`.

- [ ] **Step 3: The Help menu**

In `menu.go`, replace the existing `help.AddSeparator()` line (directly before `help.Add("Report an Issue…")`) with:

```go
	help.AddSeparator()
	// The manual route. The frontend runs the check and reports the result,
	// because the result is a dialog or a toast, which live there.
	help.Add("Check for Updates…").OnClick(func(*application.Context) {
		app.Event.Emit("menu:check-updates")
	})
	// Ticked only for "on": "unasked" reads as off here, and clicking it
	// answers the first-launch question the same way the dialog would.
	helpCurrent := docs.Settings()
	help.AddCheckbox("Check for Updates Automatically", helpCurrent.UpdateCheck == "on").OnClick(func(*application.Context) {
		next := docs.Settings()
		if next.UpdateCheck == "on" {
			next.UpdateCheck = "off"
		} else {
			next.UpdateCheck = "on"
		}
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save the update-check setting: %v", err)
		}
	})
	help.AddSeparator()
```

- [ ] **Step 4: Regenerate the bindings and check**

Run from the repo root: `wails3 task common:generate:bindings`
Then:
```bash
grep -n 'CheckForUpdates' frontend/bindings/hermes/documentservice.ts
grep -n 'updateCheck\|interface UpdateResult' frontend/bindings/hermes/models.ts
go test ./. && go build -o /dev/null .
(cd frontend && npm run check)
```
Expected: the function with `force: boolean` returning `$CancellablePromise<$models.UpdateResult>`; `"updateCheck": string;` on `Settings`; an `UpdateResult` interface with `checked`, `available`, `current`, `latest`, `url`. Go and the type check clean.

- [ ] **Step 5: Commit**

```bash
git add updates/latest.json Taskfile.yml menu.go frontend/bindings
git commit -m "feat: the version feed, a release guard on it, and Help → Check for Updates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Wire the ask, the checks and the dialogs into `App.svelte`

**Files:**
- Modify: `frontend/src/App.svelte` (imports; state near `recovery`; `refreshSettings`; new functions after `discardRecoveredDraft`; the `onMount` event list and startup block; template after the Recover-draft `Dialog`)
- Modify: `frontend/src/App.test.ts` (mock setup; a new `describe('update check')`)

**Interfaces:**
- Consumes: `DocumentService.CheckForUpdates(force)`, `UpdateResult`, `Settings.updateCheck` (Task 3); `Browser.OpenURL` from `@wailsio/runtime` (already mocked in the tests); `Dialog`, `toast`, `chartOpen`, `tableOpen`, `recovery`, `recents`, `doNew` (existing).

- [ ] **Step 1: Extend the test mocks**

In `App.test.ts`, inside `vi.hoisted`: add `updateCheck: 'off'` to `DEFAULT_SETTINGS` (off, so the existing tests are never interrupted by the ask), and to `DocumentService`:

```ts
      CheckForUpdates: vi.fn(async (_force: boolean) => ({
        checked: true, available: false, current: '0.9.0', latest: '0.9.0',
        url: 'https://github.com/richarc/hermes/releases/tag/v0.9.0',
      })),
```

Change the `@wailsio/runtime` mock so `Browser.OpenURL` is reachable from tests: it already is `Browser: { OpenURL: vi.fn() }`; import it in the test file with `import { Browser } from '@wailsio/runtime'` after the mocks (vitest resolves it to the mock).

- [ ] **Step 2: Write the failing App tests**

Append to `App.test.ts`:

```ts
describe('update check', () => {
  const AVAILABLE = {
    checked: true, available: true, current: '0.9.0', latest: '0.10.0',
    url: 'https://github.com/richarc/hermes/releases/tag/v0.10.0',
  }
  function askDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Check for updates"]')!
  }
  function noticeDialog(target: HTMLElement) {
    return target.querySelector<HTMLDialogElement>('dialog[aria-label="Update available"]')!
  }

  // vi.clearAllMocks clears calls, not implementations, so anything a test
  // here sets with mockImplementation would leak into the next. Restore
  // both defaults before each.
  beforeEach(() => {
    DocumentService.CheckForUpdates.mockImplementation(async () => ({
      checked: true, available: false, current: '0.9.0', latest: '0.9.0',
      url: 'https://github.com/richarc/hermes/releases/tag/v0.9.0',
    }))
    DocumentService.RecoverDraft.mockImplementation(async () => ({ found: false, content: '' }))
  })

  it('asks once at first launch, and Check Automatically saves on and checks', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))
    expect(target.textContent).toContain('Nothing about you or your documents is sent.')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()

    buttonByText(askDialog(target), 'Check Automatically')!.click()
    flushSync()

    expect(askDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('on')
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(false))
  })

  it("Don't Check saves off and fetches nothing", async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))

    buttonByText(askDialog(target), "Don't Check")!.click()
    flushSync()

    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('off')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('Esc on the question counts as Don\'t Check, so it is asked once', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(askDialog(target).open).toBe(true))

    askDialog(target).dispatchEvent(new Event('cancel'))
    flushSync()

    expect(askDialog(target).open).toBe(false)
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].updateCheck).toBe('off')
  })

  it('does not ask while a recovery draft is being offered', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'unasked' }
    DocumentService.RecoverDraft.mockImplementation(async (docPath: string) =>
      docPath === '' ? { found: true, content: '# Scratch\n' } : { found: false, content: '' },
    )
    const { target } = mountApp()
    await vi.waitFor(() =>
      expect(target.querySelector<HTMLDialogElement>('dialog[aria-label="Recover draft"]')!.open).toBe(true),
    )
    expect(askDialog(target).open).toBe(false)
  })

  it('checks automatically at launch when the setting is on, and shows nothing when up to date', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(noticeDialog(target).open).toBe(false)
    expect(target.querySelector('.toast')).toBeNull()
  })

  it('shows the update dialog when a newer version is available, and View Release opens it', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockResolvedValueOnce(AVAILABLE)
    const { target } = mountApp()
    await vi.waitFor(() => expect(noticeDialog(target).open).toBe(true))
    expect(target.textContent).toContain('Hermes 0.10.0 is available. You have 0.9.0.')

    buttonByText(noticeDialog(target), 'View Release')!.click()
    flushSync()

    expect(Browser.OpenURL).toHaveBeenCalledWith(AVAILABLE.url)
    expect(noticeDialog(target).open).toBe(false)
  })

  it('Later closes the dialog without opening anything', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockResolvedValueOnce(AVAILABLE)
    const { target } = mountApp()
    await vi.waitFor(() => expect(noticeDialog(target).open).toBe(true))

    buttonByText(noticeDialog(target), 'Later')!.click()
    flushSync()

    expect(noticeDialog(target).open).toBe(false)
    expect(Browser.OpenURL).not.toHaveBeenCalled()
  })

  it('does not check at launch when the setting is off', async () => {
    mountApp()
    await new Promise((r) => setTimeout(r, 20))
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('Help → Check for Updates… forces a check and says when it is up to date', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    listeners['menu:check-updates']({ data: null })

    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(target.textContent).toContain('Hermes 0.9.0 is up to date.'))
  })

  it('a manual check reports a failure', async () => {
    DocumentService.CheckForUpdates.mockRejectedValueOnce(new Error('the version feed returned 404 Not Found'))
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    listeners['menu:check-updates']({ data: null })

    await vi.waitFor(() =>
      expect(target.textContent).toContain('Could not check for updates: Error: the version feed returned 404 Not Found'),
    )
  })

  it('an automatic check that fails stays quiet', async () => {
    settings.current = { ...DEFAULT_SETTINGS, updateCheck: 'on' }
    DocumentService.CheckForUpdates.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.CheckForUpdates).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(target.querySelector('.toast')).toBeNull()
    expect(noticeDialog(target).open).toBe(false)
    warn.mockRestore()
  })

  it('refuses a manual check while the chart builder is open', async () => {
    const target = await openDoc('# Results\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()

    listeners['menu:check-updates']({ data: null })
    flushSync()

    expect(target.textContent).toContain('Finish or cancel the chart or table before checking for updates.')
    expect(DocumentService.CheckForUpdates).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `frontend/`: `npx vitest run src/App.test.ts -t 'update check'`
Expected: FAIL. No dialog labelled "Check for updates"; `CheckForUpdates` never called.

- [ ] **Step 4: Wire `App.svelte`**

Imports: change the runtime import to `import { Events, Browser } from '@wailsio/runtime'`, and extend the models import to `import type { Settings, Draft, UpdateResult } from '../bindings/hermes/models'`.

State, after the `recovery` declaration:

```ts
  type UpdateCheckSetting = 'unasked' | 'on' | 'off'
  let updateCheck = $state<UpdateCheckSetting>('unasked')
  // The first-launch question; true only until it has been answered once.
  let askUpdates = $state(false)
  // A newer version, awaiting Later / View Release. Null when no dialog is up.
  let updateNotice = $state<UpdateResult | null>(null)
```

`refreshSettings`, after `autoSave = s.autoSave`:

```ts
    // Go clamps to the three values, so the cast is a spelling of what the
    // binding cannot express.
    updateCheck = s.updateCheck as UpdateCheckSetting
```

New functions, after `discardRecoveredDraft`:

```ts
  // The first-launch question, answered once. Both answers are stored, so
  // the dialog never comes back; Esc is "Don't Check" for the same reason.
  async function answerUpdateQuestion(answer: 'on' | 'off') {
    askUpdates = false
    try {
      const current: Settings = await DocumentService.Settings()
      await DocumentService.UpdateSettings({ ...current, updateCheck: answer })
    } catch (err) {
      toast(`Could not save the update-check setting: ${err}`)
      return
    }
    if (answer === 'on') void checkForUpdates(false)
  }

  // manual: Help → Check for Updates…, which ignores the daily throttle and
  // always reports. Automatic: at launch, which only speaks up when there is
  // something to say — an offline launch must not nag.
  async function checkForUpdates(manual: boolean) {
    if (manual && (chartOpen || tableOpen)) {
      toast('Finish or cancel the chart or table before checking for updates.')
      return
    }
    try {
      const result: UpdateResult = await DocumentService.CheckForUpdates(manual)
      if (result.available) {
        updateNotice = result
        return
      }
      if (manual) toast(`Hermes ${result.current} is up to date.`)
    } catch (err) {
      if (manual) toast(`Could not check for updates: ${err}`)
      else console.warn('CheckForUpdates:', err)
    }
  }

  function viewRelease() {
    const notice = updateNotice
    updateNotice = null
    if (notice) void Browser.OpenURL(notice.url)
  }
```

`onMount` event list, after `Events.On('settings:changed', ...)`:

```ts
    Events.On('menu:check-updates', () => void checkForUpdates(true))
```

Startup block: replace the tail of the async IIFE (from `await offerDraft('')` to the closing `})()`) with:

```ts
      await offerDraft('')
      // A recovery offer is the more urgent dialog; the update question and
      // the automatic check wait for a launch with nothing else on screen.
      if (recovery !== null) return
      // A first launch has nothing to put in the welcome pane, so go straight
      // into a templated document rather than an empty one — the user who has
      // never seen Hermes is exactly the one the template is for.
      if (recents.length === 0) doNew()
      if (updateCheck === 'unasked') askUpdates = true
      else if (updateCheck === 'on') void checkForUpdates(false)
    })()
```

Template, after the Recover-draft `Dialog`:

```svelte
  <Dialog open={askUpdates} label="Check for updates" onclose={() => void answerUpdateQuestion('off')}>
    <p>
      Hermes can fetch a small file from GitHub once a day to see whether a newer version exists.
      Nothing about you or your documents is sent. You can change this later in the Help menu.
    </p>
    {#snippet footer()}
      <button onclick={() => void answerUpdateQuestion('off')}>Don't Check</button>
      <button class="primary" onclick={() => void answerUpdateQuestion('on')}>Check Automatically</button>
    {/snippet}
  </Dialog>

  <Dialog open={updateNotice !== null} label="Update available" onclose={() => (updateNotice = null)}>
    {#if updateNotice}
      <p>Hermes {updateNotice.latest} is available. You have {updateNotice.current}.</p>
    {/if}
    {#snippet footer()}
      <button onclick={() => (updateNotice = null)}>Later</button>
      <button class="primary" onclick={viewRelease}>View Release</button>
    {/snippet}
  </Dialog>
```

- [ ] **Step 5: Run the App tests, then everything**

Run from `frontend/`: `npx vitest run src/App.test.ts -t 'update check'`
Expected: PASS, 12 tests.

Run from `frontend/`: `npx vitest run && npm run check`
Expected: all green. If an existing test breaks only because `DEFAULT_SETTINGS` gained a key or the startup now reads `updateCheck`, adjust that assertion and say so in the report; anything else is investigated, not papered over.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "feat: ask once, check for updates at launch or from Help, and offer the release page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Documentation, build, and the click-through

**Files:**
- Modify: `README.md` (after the "Requires macOS 12 or later" paragraph in Download; the "Cutting a release" section)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`, first bullet)
- Modify: `CLAUDE.md` (the events sentence in Architecture item 4; a bullet in "Other things to know" after the recovery-drafts bullet)
- Modify: `ROADMAP.md` (the v0.10.0 update-check item)

- [ ] **Step 1: README**

After the paragraph ending "only needed for picking citations from your library." in the Download section, add:

```markdown
### Updates

Hermes can check for a newer version. It fetches one small file from GitHub
(`updates/latest.json` in this repository) at most once a day and compares the
version inside it with its own; nothing about you, your machine or your
documents is sent, and nothing is downloaded or installed — if there is a
newer version you get a button that opens the release page. Hermes asks
whether to do this the first time it starts. **Help → Check for Updates
Automatically** turns it on or off later, and **Help → Check for Updates…**
checks right now.
```

In "Cutting a release", after the `release:verify` code block and before the paragraph beginning "`release` needs a **Developer ID Application**", add:

```markdown
The order matters for the update check. Bump `version` in `build/config.yml`
and `updates/latest.json` together in one commit (`release` refuses to run if
they differ), cut the release, publish it on GitHub with the zip attached,
and only then push `main` and the tag. Installed copies read the feed from
`main`, so pushing first would announce a version nobody can download yet.
```

- [ ] **Step 2: CHANGELOG**

First bullet under `### Added` in `## [Unreleased]`:

```markdown
- An update check that sends nothing. Hermes fetches a one-line version
  file from this repository at most once a day, compares it with its own
  version, and if there is a newer release shows a dialog with a button
  that opens the release page; the download is still by hand. No
  identifier, no installed version and no query string travel with the
  request. Asked once at first launch; Help → Check for Updates
  Automatically switches it later, and Help → Check for Updates… checks
  now.
```

- [ ] **Step 3: CLAUDE.md**

In Architecture item 4, in the list of events emitted by `menu.go`, after `` `menu:export-pdf` (payloadless — …) ``, insert `` `menu:check-updates` (payloadless — the frontend owns the dialog and toast that report the result), `` so the sentence keeps its shape.

In "Other things to know", after the recovery-drafts bullet, add:

```markdown
- The update check is `update.go`: `CheckForUpdates(force)` GETs the bare feed URL (`updates/latest.json` on `main`, via raw.githubusercontent.com) with no query string and no custom header, at most once per 24 h through a timestamp in `<data>/hermes/update-check.json` written before the fetch, validates the version as `MAJOR.MINOR.PATCH`, and **derives** the release URL from it — the feed is never trusted for a destination. `force` (Help → Check for Updates…) skips the throttle. The feed, the release guard in `Taskfile.yml`, and the push-last ordering in README's release steps are one contract: bump `config.yml` and the feed together, publish, then push. The three-state `updateCheck` setting is asked about once at first launch in `App.svelte`, after the recovery-draft offer and never over it.
```

- [ ] **Step 4: Tick the roadmap item**

```python
import pathlib
p = pathlib.Path('ROADMAP.md'); s = p.read_text()
old = "- [ ] **An update check that sends nothing.** Decided 2026-09-01 as the"
new = ("- [x] **An update check that sends nothing.** Done 2026-09-02, unreleased:\n"
       "      the design in `docs/superpowers/specs/2026-09-02-update-check-design.md`,\n"
       "      the code in `update.go` and `App.svelte`. One change from the note\n"
       "      below: the feed is `updates/latest.json` in this repository rather\n"
       "      than the Releases API, static and available today, with a release\n"
       "      precondition that it matches `config.yml`. Decided 2026-09-01 as the")
assert s.count(old) == 1
p.write_text(s.replace(old, new))
```

Then check `grep -c '^- \['` is unchanged (58) and `grep '^## '` is unchanged against `git show HEAD:ROADMAP.md`.

- [ ] **Step 5: Build, verify, hand over for the click-through**

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
wails3 task build
strings "bin/Hermes Editor" | grep -c CheckForUpdates
```

Expected: a non-zero count. Do not run `wails3 task run`; the click-through needs the user at the window. Note for the tester: the built binary in `bin/` is unbundled for `wails3 task run`'s `.dev.app` wrapper only in the sense that it carries a version from `config.yml` (0.9.0), so with the feed at `0.9.0` a manual check reports up to date. To see the dialog, temporarily point the feed at a higher version on a branch, or edit `updates/latest.json` locally and serve it — the simplest is to push a branch with `{"version": "0.9.1"}` and change `updateFeedURL` to that branch's raw URL in a throwaway build.

Ask the user to check:

1. Delete `~/Library/Application Support/hermes/update-check.json` and set `updateCheck` to `unasked` in `settings.json` (or delete that key). Launch: the "Check for updates" dialog appears after the template or welcome pane. Check Automatically → no dialog (up to date), `update-check.json` appears, `settings.json` says `"updateCheck":"on"`.
2. Relaunch: no question, no dialog, and `update-check.json`'s timestamp does not change (throttled).
3. Help → Check for Updates…: toast "Hermes 0.9.0 is up to date." and the timestamp updates.
4. Help → Check for Updates Automatically unticks; relaunch: no check (timestamp unchanged after deleting the file first).
5. With the throwaway feed at 0.9.1: the "Update available" dialog; View Release opens the release page in the browser; Later closes it.
6. Disconnect the network, Help → Check for Updates…: a toast naming the failure; relaunch with the setting on: nothing shown.
7. Force-quit with an untitled draft pending and `updateCheck` unasked: on relaunch the Recover-draft dialog appears and the update question does not; after answering the recovery, the next launch asks.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md ROADMAP.md
git commit -m "docs: the update check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: feed file and derivation (Tasks 2, 3), privacy rules with tests (Task 2), throttle in a state file written before the fetch (Task 2), three-state setting (Task 1), Help menu items and event (Task 3), first-launch ask after the recovery offer and never over it (Task 4), automatic and manual result handling including the builder refusal (Task 4), release guard and push-last ordering (Tasks 3, 5), docs (Task 5).
- Deviation recorded in the spec: the feed is a repo file, not the Releases API.
- Not tested by automation: the menu checkbox and the `Taskfile.yml` precondition (exercised only when a release is cut; a dry check is `grep -q '"version": "0.9.0"' updates/latest.json` after Task 3).
- Type consistency: `UpdateResult` fields `Checked/Available/Current/Latest/URL` in Go become `checked/available/current/latest/url` in TS; `CheckForUpdates(force bool)` ↔ `CheckForUpdates(force: boolean)`; the setting is `UpdateCheck`/`updateCheck` everywhere; the event is `menu:check-updates` in `menu.go`, `App.svelte`, the tests and `CLAUDE.md`.
