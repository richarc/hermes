package main

import (
	"embed"

	"log"

	"github.com/adrg/xdg"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

// main function serves as the application's entry point. It initializes the application, creates a window,
// runs the application, and logs any error that might occur.
// The window background is what shows for the moment before the webview
// paints, so it has to match what the webview is about to paint — these are a
// second copy of the --bg tokens in frontend/public/style.css, kept because Go
// cannot read that file. They have drifted twice; windowbg_test.go now reads
// the stylesheet and fails if either copy moves without the other.
//
// Written as hex bytes rather than decimal so the two files read the same way.
// Checking #1f1f1f against #1f1f1f is a glance; checking it against
// NewRGB(31, 31, 31) is arithmetic, and arithmetic is what nobody does on the
// way past — which is how the drift happened.
var (
	lightWindowBg = application.NewRGB(0xfc, 0xfc, 0xfc)
	darkWindowBg  = application.NewRGB(0x1f, 0x1f, 0x1f)
)

// windowBackground is the colour the window wears until the webview's first
// frame arrives. Split out of main so it is testable — AppKit window creation
// is not exercisable headlessly, the same reason feedbackURL and quitRequest
// are separate from what calls them.
//
// "system" keeps the light value: resolving it would mean reading the OS
// appearance through cgo, which is disproportionate for a flash at launch.
func windowBackground(theme string) application.RGBA {
	if theme == "dark" {
		return darkWindowBg
	}
	return lightWindowBg
}

func main() {

	recentsPath, err := xdg.DataFile("hermes/recents.json")
	if err != nil {
		log.Fatal(err)
	}
	docs := NewDocumentService(recentsPath)

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	app := application.New(application.Options{
		Name:        "Hermes Editor",
		Description: "Academic markdown editor",
		Services:    []application.Service{application.NewService(docs)},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// Serves images living beside the user's document. Without it a
			// document-relative <img src> resolves against the embedded
			// bundle and 404s. See localimages.go.
			Middleware: localImages,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	windowBg := windowBackground(docs.Settings().Theme)

	// Create a new window with the necessary options.
	// 'Title' is the title of the window.
	// 'Mac' options tailor the window when running on macOS.
	// 'BackgroundColour' is the background colour of the window.
	// 'URL' is the URL that will be loaded into the webview.
	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Hermes",
		Width:  1200,
		Height: 800,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			// Normal backdrop: the app paints an opaque white background, so
			// the template's translucent NSVisualEffectView only added the
			// oversized "glass" corner radius on macOS 26.
			Backdrop: application.MacBackdropNormal,
			TitleBar: application.MacTitleBarHiddenInset,
		},
		BackgroundColour: windowBg,
		URL:              "/",
	})

	docs.window = win
	// Focus() dispatches to the main thread itself (InvokeSync) and no-ops on
	// a destroyed window, so it needs no wrapping here.
	docs.onRefocus = win.Focus

	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if docs.IsDirty() {
			e.Cancel()
			app.Event.Emit("close:confirm")
		}
	})

	// Rebuild the menu (Open Recent submenu) whenever recents change. The
	// change can originate on a binding goroutine, so hop to the main thread
	// for the AppKit calls; the event lets the frontend refresh its own list.
	docs.onRecentsChanged = func() {
		application.InvokeAsync(func() {
			installMenu(app, win, docs)
		})
		app.Event.Emit("recents:changed")
	}
	// One notification for every preference: the menu re-reads whichever ones
	// it renders, and the frontend is told so it can pick up the rest. Adding
	// a setting needs no new wiring here.
	docs.settings.onChanged = func() {
		application.InvokeAsync(func() {
			installMenu(app, win, docs)
		})
		app.Event.Emit("settings:changed")
	}

	installMenu(app, win, docs)

	// Run the application. This blocks until the application has been exited.
	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
