package main

import (
	"net/url"
	"strings"
)

// Where the Help menu points.
//
// Both are placeholders standing in for destinations that do not exist yet:
// the documentation site and a hosted feedback form. They point at the public
// repository meanwhile, so neither menu item is a dead link. Replacing them is
// a one-line change each — nothing else in this file assumes what they are.
const (
	// TODO: replace with the documentation site when it ships.
	docsURL = "https://github.com/richarc/hermes#readme"

	// TODO: replace with the hosted feedback form (Tally, Formspree or
	// similar). GitHub Issues is the stand-in, not the intended destination:
	// it demands an account and reads as developer territory, which is the
	// opposite of what this item is for.
	feedbackBaseURL = "https://github.com/richarc/hermes/issues/new"
)

// feedbackURL is the report form with the details a user would never think to
// include already filled in.
//
// Which is the whole point of building this into the application rather than
// putting a link in the README: a report that does not say which version it
// came from usually cannot be acted on, and asking people to find that out is
// how you get no reports at all.
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
	q.Set("version", appVersion)
	q.Set("os", osDescription(osName, osVersion))
	return feedbackBaseURL + "?" + q.Encode()
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
