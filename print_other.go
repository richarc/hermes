//go:build !darwin

package main

// printWithOrientation reports false off macOS so the caller falls back to
// the default Wails print path; other platforms' print dialogs manage
// orientation themselves.
func printWithOrientation(landscape bool) bool { return false }
