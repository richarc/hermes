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
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

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
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(255, 255, 255),
		URL:              "/",
	})

	docs.window = win

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

	installMenu(app, win, docs)

	// Run the application. This blocks until the application has been exited.
	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
