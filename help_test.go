package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestFeedbackURL(t *testing.T) {
	got := feedbackURL("0.7.0", "macOS", "26.3.1")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("not a URL: %v", err)
	}
	body := parsed.Query().Get("body")

	// The version fields are the entire reason this is built in the app
	// rather than being a plain link: users never think to include them, and
	// without them a report is usually unactionable. GitHub only reads its own
	// parameters, so they have to arrive inside the issue body.
	if !strings.Contains(body, "**Hermes version:** 0.7.0\n") {
		t.Errorf("body does not carry the version: %q", body)
	}
	if !strings.Contains(body, "**Operating system:** macOS 26.3.1\n") {
		t.Errorf("body does not carry the OS: %q", body)
	}
	if !strings.HasPrefix(got, feedbackBaseURL) {
		t.Errorf("does not point at GitHub Issues: %q", got)
	}
	if parsed.Query().Has("version") || parsed.Query().Has("os") {
		t.Errorf("version and os must travel in the body, not as parameters GitHub ignores: %q", got)
	}
}

// A space in the OS name and a plus in a version must survive the round trip
// rather than arriving as a separator.
func TestFeedbackURLEscapes(t *testing.T) {
	got := feedbackURL("0.7.0+dev", "macOS Sequoia", "26.3.1")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("not a URL: %v", err)
	}
	body := parsed.Query().Get("body")
	if !strings.Contains(body, "**Hermes version:** 0.7.0+dev\n") {
		t.Errorf("version mangled: %q", body)
	}
	if !strings.Contains(body, "**Operating system:** macOS Sequoia 26.3.1\n") {
		t.Errorf("os mangled: %q", body)
	}
}

// An unbundled binary — `go run`, or the bare executable in CI — has no
// Info.plist to read a version from. The report should still be sendable.
func TestFeedbackURLWithoutAVersion(t *testing.T) {
	got := feedbackURL("", "macOS", "26.3.1")

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("not a URL: %v", err)
	}
	if body := parsed.Query().Get("body"); !strings.Contains(body, "**Hermes version:** unknown\n") {
		t.Errorf("body should say the version is unknown: %q", body)
	}
}

func TestOSDescription(t *testing.T) {
	tests := []struct {
		name    string
		os      string
		version string
		want    string
	}{
		{"name and version", "macOS", "26.3.1", "macOS 26.3.1"},
		{"version missing", "macOS", "", "macOS"},
		{"name missing", "", "26.3.1", "26.3.1"},
		{"both missing", "", "", "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := osDescription(tt.os, tt.version); got != tt.want {
				t.Errorf("osDescription(%q, %q) = %q, want %q", tt.os, tt.version, got, tt.want)
			}
		})
	}
}

// The licence texts are copied into Contents/Resources/licences when the app
// is packaged. Unbundled — `go run`, or the bare binary — there is nowhere to
// look, and the caller falls back to the repository.
func TestLicencesPath(t *testing.T) {
	got, ok := licencesPath("/Applications/Hermes Editor.app/Contents/Resources")
	if !ok {
		t.Fatal("expected a path from a real resources directory")
	}
	want := "/Applications/Hermes Editor.app/Contents/Resources/licences"
	if got != want {
		t.Errorf("path = %q, want %q", got, want)
	}
}

func TestLicencesPathUnbundled(t *testing.T) {
	if _, ok := licencesPath(""); ok {
		t.Error("expected no path when there is no resources directory")
	}
}
