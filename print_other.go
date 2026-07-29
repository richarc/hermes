//go:build !darwin

package main

// applyPrintOrientation is a no-op off macOS; other platforms' print
// dialogs manage orientation themselves.
func applyPrintOrientation(landscape bool) {}
