//go:build !darwin

package main

// appVersion has no bundle to read on other platforms. Reported as unknown
// until there is a packaging story there — see the Windows note in ROADMAP.md.
func appVersion() string { return "" }
