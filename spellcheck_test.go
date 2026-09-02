//go:build darwin

package main

import "testing"

// WebKit reads WebContinuousSpellCheckingEnabled raw from the app's defaults
// with no registered default, so a WKWebView app has continuous checking
// off until something sets the key. registerDefaults supplies the value the
// raw read falls back to; it is not persisted, so calling it in a test does
// not touch the developer's preferences.
func TestRegisterSpellCheckingDefaultsTurnsContinuousCheckingOn(t *testing.T) {
	registerSpellCheckingDefaults()
	if !continuousSpellCheckingDefault() {
		t.Error("want WebContinuousSpellCheckingEnabled to read as true after registering the default")
	}
}
