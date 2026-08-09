package main

import (
	"io"
	"log/slog"
	"sync"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The App menu's role items are built by Wails against globalApplication, so
// one has to exist before a menu can be constructed at all. Created once and
// silenced — application.New logs three banner lines otherwise, and test
// output should be pristine.
var testApp = sync.OnceFunc(func() {
	application.New(application.Options{
		Name:   "Hermes Editor",
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
})

// This is the test that the first attempt at the ⌘Q fix needed and did not
// have. That attempt replaced the Quit item's OnClick and shipped, and ⌘Q went
// on discarding documents: on macOS a role-based item is created with
// target=nil and the role's own selector — Quit maps to `terminate:` in Wails'
// roleToSelector table — so AppKit sends the action up the responder chain to
// NSApp and the Go callback is never invoked. Clearing the role is what puts
// the item back on the handleClick path.
//
// Testing quitRequest alone did not catch it, because quitRequest was never
// reached. This tests the wiring instead.
func TestReclaimQuitItemClearsTheRoleThatBypassesGo(t *testing.T) {
	testApp()
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	if menu.FindByRole(application.Quit) == nil {
		t.Fatal("precondition failed: the App menu should carry a Quit role item")
	}

	quit := reclaimQuitItem(menu)
	if quit == nil {
		t.Fatal("want the Quit item back so a handler can be attached")
	}
	if menu.FindByRole(application.Quit) != nil {
		t.Error("the Quit role must be cleared; while it is set, macOS binds " +
			"terminate: and the Go handler never runs")
	}
	if got := quit.Label(); got == "" {
		t.Error("the item must keep its label")
	}
	if got := quit.GetAccelerator(); got == "" {
		t.Error("the item must keep ⌘Q, or the shortcut stops working entirely")
	}
}

func TestReclaimQuitItemToleratesAMenuWithoutOne(t *testing.T) {
	testApp()
	if got := reclaimQuitItem(application.NewMenu()); got != nil {
		t.Errorf("want nil for a menu with no Quit item, got %v", got)
	}
}

// The branch ⌘Q takes once it does reach Go. Separate from the wiring above:
// both have to be right, and the first attempt got the wiring wrong while this
// half was already correct.
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
