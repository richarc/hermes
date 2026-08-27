package main

import (
	"net/url"
	"path/filepath"
	"strings"
)

// Where the Help menu points.
//
// docsURL is a placeholder standing in for the documentation site, which does
// not exist yet; it points at the repository meanwhile so the menu item is not
// a dead link. Replacing it is a one-line change — nothing else assumes what
// it is.
//
// feedbackBaseURL is not a placeholder. A hosted form (Tally, Formspree or
// similar) was considered and rejected on 2026-08-27 in favour of GitHub
// Issues: a report there is public, threaded, and lands where the work is
// tracked, and the URL can prefill the body — so the cost of an account is
// paid for by a report that can be acted on and replied to.
const (
	// TODO: replace with the documentation site when it ships.
	docsURL = "https://github.com/richarc/hermes#readme"

	feedbackBaseURL = "https://github.com/richarc/hermes/issues/new"
)

// feedbackURL is the new-issue page with the details a user would never think
// to include already filled in.
//
// Which is the whole point of building this into the application rather than
// putting a link in the README: a report that does not say which version it
// came from usually cannot be acted on, and asking people to find that out is
// how you get no reports at all.
//
// GitHub reads only its own query parameters — `title`, `body`, `labels` and
// so on — so the version and OS travel inside `body`, as the head of an issue
// the reporter finishes writing, rather than as fields of their own.
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
	q.Set("body", feedbackBody(appVersion, osDescription(osName, osVersion)))
	return feedbackBaseURL + "?" + q.Encode()
}

// feedbackBody is the prefilled head of an issue: the environment as a short
// list, then the headings a useful report has, left for the reporter to fill.
func feedbackBody(appVersion, os string) string {
	return "**Hermes version:** " + appVersion + "\n" +
		"**Operating system:** " + os + "\n\n" +
		"**What happened**\n\n\n" +
		"**What you expected**\n\n\n" +
		"**Steps to reproduce**\n\n"
}

// osDescription joins an operating system's name and version into something a
// human would recognise, tolerating either being absent — Wails populates
// OSInfo per platform and neither field is guaranteed.
func osDescription(name, version string) string {
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
