package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	for _, bad := range []string{
		`{}`,
		`{"version": ""}`,
		`{"version": "0.10"}`,
		`{"version": "../x"}`,
		`not json`,
		`{"version": "0.10.0", "url": "https://evil"}`,
		`{"version": "0.10.0"} trailing`,
		`{"version": "0.10.0"}{"version": "9.9.9"}`,
		`{"version": "v0.10.0"}`,
	} {
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
	// Enable the setting so existing tests keep fetching.
	next := s.Settings()
	next.UpdateCheck = "on"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
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

func TestCheckForUpdatesFetchesNothingUnlessOn(t *testing.T) {
	for _, setting := range []string{"unasked", "off"} {
		t.Run(setting, func(t *testing.T) {
			s, hits, _ := newUpdateTestService(t, `{"version": "0.10.0"}`, http.StatusOK)
			next := s.Settings()
			next.UpdateCheck = setting
			if err := s.UpdateSettings(next); err != nil {
				t.Fatal(err)
			}
			got, err := s.CheckForUpdates(false)
			if err != nil {
				t.Fatalf("want nil error, got %v", err)
			}
			if got.Checked {
				t.Errorf("want Checked=false, got %+v", got)
			}
			if got.Current != "0.9.0" {
				t.Errorf("want Current=0.9.0, got %+v", got)
			}
			if *hits != 0 {
				t.Errorf("want no fetch, got %d hits", *hits)
			}
			wantState := s.updateStatePath
			if _, err := os.Stat(wantState); err == nil {
				t.Errorf("want no state file written")
			}
		})
	}
	// A forced check ignores the setting.
	s, hits, _ := newUpdateTestService(t, `{"version": "0.10.0"}`, http.StatusOK)
	next := s.Settings()
	next.UpdateCheck = "off"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CheckForUpdates(true); err != nil {
		t.Fatal(err)
	}
	if *hits != 1 {
		t.Errorf("force must fetch even with setting off, got %d hits", *hits)
	}
}

// The privacy promise, asserted: the same bare URL every time, no query
// string, and nothing in the request that says which version is asking.
func TestCheckForUpdatesSendsNothingIdentifying(t *testing.T) {
	s, _, last := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	if last.Method != http.MethodGet {
		t.Errorf("want GET, got %s", last.Method)
	}
	if last.URL.RawQuery != "" {
		t.Errorf("query string must be empty, got %q", last.URL.RawQuery)
	}
	if last.URL.Path != "/" && !strings.HasSuffix(last.URL.Path, "latest.json") {
		t.Errorf("unexpected path %q", last.URL.Path)
	}
	// Allow-list: only User-Agent and Accept-Encoding are added by net/http.
	allowed := map[string]bool{"User-Agent": true, "Accept-Encoding": true}
	for name := range last.Header {
		if !allowed[name] {
			t.Errorf("unexpected header %s in request", name)
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

// Guard against a future timestamp: if the recorded check time is in the
// future, the throttle does not apply and we fetch.
func TestCheckForUpdatesGuardsAgainstFutureTimestamp(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `{"version": "0.9.0"}`, http.StatusOK)
	s.writeUpdateState(updateState{CheckedAt: s.now().Add(time.Hour)})
	if _, err := s.CheckForUpdates(false); err != nil {
		t.Fatal(err)
	}
	if *hits != 1 {
		t.Errorf("want a fetch with future timestamp, got %d hits", *hits)
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
		{"oversized", `{"version": "0.10.0"}` + strings.Repeat(" ", 5<<10), http.StatusOK},
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

// A manual check has no once-a-day promise to record, so a state file that
// cannot be written must not stop it. The automatic path has no such
// exemption: without the record the throttle cannot be kept, so it still
// refuses.
func TestForcedCheckSurvivesAnUnwritableStateFile(t *testing.T) {
	s, hits, _ := newUpdateTestService(t, `{"version": "0.10.0"}`, http.StatusOK)
	// The parent directory does not exist, so writeFileAtomic's CreateTemp
	// fails.
	s.updateStatePath = filepath.Join(t.TempDir(), "missing-dir", "update-check.json")

	got, err := s.CheckForUpdates(true)
	if err != nil {
		t.Fatalf("a forced check must survive an unwritable state file, got %v", err)
	}
	if !got.Available {
		t.Errorf("want Available=true, got %+v", got)
	}

	if _, err := s.CheckForUpdates(false); err == nil {
		t.Error("an automatic check must still fail closed on an unwritable state file")
	}
	if *hits != 1 {
		t.Errorf("the automatic check must not fetch, hits=%d", *hits)
	}
}

// refuseDowngrade is the CheckRedirect policy on its own, without a TLS
// server: it must not let a redirect move an https request to plain http,
// must leave same-scheme redirects alone, and must reinstate net/http's
// default cap on how many redirects a chain may have (a custom
// CheckRedirect otherwise drops that cap).
func TestRefuseDowngrade(t *testing.T) {
	req := func(scheme string) *http.Request {
		return &http.Request{URL: &url.URL{Scheme: scheme}}
	}
	for _, tc := range []struct {
		name           string
		originalScheme string
		targetScheme   string
		viaLen         int
		wantErr        bool
	}{
		{"https redirected to http errors", "https", "http", 1, true},
		{"https redirected to https is fine", "https", "https", 1, false},
		{"http redirected to http is fine", "http", "http", 1, false},
		{"ten redirects is too many", "https", "https", 10, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			via := make([]*http.Request, tc.viaLen)
			for i := range via {
				via[i] = req(tc.originalScheme)
			}
			err := refuseDowngrade(req(tc.targetScheme), via)
			if tc.wantErr && err == nil {
				t.Error("want an error")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("want no error, got %v", err)
			}
		})
	}
}

// The https guard must not break an ordinary redirect: a plain-http chain
// (no TLS server needed) still resolves and the check still runs.
func TestCheckForUpdatesFollowsAPlainHTTPRedirect(t *testing.T) {
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"version": "0.10.0"}`))
	}))
	t.Cleanup(b.Close)
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, b.URL, http.StatusFound)
	}))
	t.Cleanup(a.Close)

	s := newTestService(t)
	s.updateFeed = a.URL
	s.version = func() string { return "0.9.0" }
	s.now = func() time.Time { return time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC) }
	next := s.Settings()
	next.UpdateCheck = "on"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}

	got, err := s.CheckForUpdates(true)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Available {
		t.Errorf("want Available=true after following the redirect, got %+v", got)
	}
}

// The release task's version-equality grep (build/Taskfile.yml) runs only
// when a release is cut. This runs on every `go test`, so it fails the
// moment either file is bumped alone, or the feed stops being valid JSON.
func TestShippedFeedIsValidAndMatchesConfig(t *testing.T) {
	feedBody, err := os.ReadFile("updates/latest.json")
	if err != nil {
		t.Fatal(err)
	}
	feedVersion, err := parseUpdateFeed(feedBody)
	if err != nil {
		t.Fatalf("updates/latest.json does not parse: %v", err)
	}

	configBody, err := os.ReadFile("build/config.yml")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^  version: "([^"]+)"`).FindSubmatch(configBody)
	if m == nil {
		t.Fatal("build/config.yml has no line matching `  version: \"...\"`")
	}
	configVersion := string(m[1])

	if feedVersion != configVersion {
		t.Errorf("updates/latest.json version %q does not match build/config.yml version %q", feedVersion, configVersion)
	}
}
