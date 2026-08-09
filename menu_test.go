package main

import "testing"

// ⌘Q used to discard unsaved work. The guard in main.go is registered on
// events.Common.WindowClosing, a *window* event, but the App menu's Quit role
// calls application.Quit() directly — InvokeSync(impl.destroy) — which never
// dispatches one, so nothing consulted IsDirty(). Closing by the red button
// or ⌘W prompted correctly, which is what isolated it to the terminate path.
//
// The branch below is the whole fix, and getting it backwards loses the
// user's document, so it is a tested function rather than an inline `if`
// inside a menu closure that no test can reach.
func TestQuitRequestConfirmsWhenDirty(t *testing.T) {
	confirmed, quit := 0, 0
	quitRequest(true, func() { confirmed++ }, func() { quit++ })

	if confirmed != 1 {
		t.Errorf("a dirty document must raise the confirm, raised %d", confirmed)
	}
	if quit != 0 {
		t.Errorf("a dirty document must not quit yet, quit %d", quit)
	}
}

func TestQuitRequestQuitsWhenClean(t *testing.T) {
	confirmed, quit := 0, 0
	quitRequest(false, func() { confirmed++ }, func() { quit++ })

	if quit != 1 {
		t.Errorf("a clean document must quit, quit %d", quit)
	}
	if confirmed != 0 {
		t.Errorf("a clean document must not prompt, raised %d", confirmed)
	}
}
