package main

import (
	"net/url"
	"path/filepath"
	"strings"
)

// Where the Help menu points.
//
// docsURL is the guides section of the documentation site. The welcome pane
// in App.svelte names the same address in prose, so the two must move
// together.
//
// feedbackBaseURL is not a placeholder. A hosted form (Tally, Formspree or
// similar) was considered and rejected on 2026-08-27 in favour of GitHub
// Issues: a report there is public, threaded, and lands where the work is
// tracked, and the URL can prefill the body — so the cost of an account is
// paid for by a report that can be acted on and replied to.
const (
	docsURL = "https://www.hermeseditor.com/guides"

	feedbackBaseURL  = "https://github.com/richarc/hermes/issues/new"
	feedbackTemplate = "bug_report.yml"
)

// feedbackURL is the bug report form with the details a user would never
// think to include already filled in.
//
// Which is the whole point of building this into the application rather than
// putting a link in the README: a report that does not say which version it
// came from usually cannot be acted on, and asking people to find that out is
// how you get no reports at all.
//
// The form is .github/ISSUE_TEMPLATE/bug_report.yml. GitHub fills an issue
// form's fields from query parameters named by the fields' ids, so `version`
// and `os` here must match the ids there; `template` names the form, since a
// bare issues/new opens the chooser once blank issues are turned off.
//
// Split from the menu closure so it is reachable by a test, the same reason
// quitRequest and localImagePath are separate from what calls them — AppKit
// menu construction cannot be exercised headlessly.
func feedbackURL(appVersion, osName, osVersion string) string {
	if appVersion == "" {
		// An unbundled binary has no Info.plist to read a version from. Say so
		// rather than sending an empty field, which reads as a bug in the form.
		appVersion = "unknown"
	}
	q := url.Values{}
	q.Set("template", feedbackTemplate)
	q.Set("version", appVersion)
	q.Set("os", osDescription(osName, osVersion))
	return feedbackBaseURL + "?" + q.Encode()
}

// osDescription joins an operating system's name and version into something a
// human would recognise, tolerating either being absent — Wails populates
// OSInfo per platform and neither field is guaranteed. On macOS the name is
// Wails' branding, which for a release it has no marketing name for is
// already "MacOS <version>"; appending the version again gave "MacOS 26.6.2
// 26.6.2" in issue #8, so a name that ends with the version is left alone.
func osDescription(name, version string) string {
	if version != "" && strings.HasSuffix(name, version) {
		version = ""
	}
	joined := strings.TrimSpace(name + " " + version)
	if joined == "" {
		return "unknown"
	}
	return joined
}

// licencesPath is where the bundled licence texts live, given the
// application's Contents/Resources directory, and whether there is one at all.
//
// Taskfile.yml's bundle:licences copies them there when the app is packaged:
// Apache-2.0 requires NOTICE to travel with the work, and citeproc-js is dual
// CPAL/AGPL, both of which require their licence to accompany a distributed
// binary. Having them in the repository covers source distribution only.
//
// Split out so the join is testable without a bundle to run in — mac.ResourcePath
// reports ErrNotInAppBundle for a bare binary, which is the ordinary case
// under `go run` and in CI.
func licencesPath(resourcesDir string) (string, bool) {
	if resourcesDir == "" {
		return "", false
	}
	return filepath.Join(resourcesDir, "licences"), true
}
