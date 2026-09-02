//go:build !darwin

package main

// Only WebKit on macOS keeps its spell-checking flag in NSUserDefaults;
// there is nothing to register elsewhere.
func registerSpellCheckingDefaults() {}
