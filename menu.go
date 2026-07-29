package main

import (
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// installMenu builds and sets the application menu. It is called again
// whenever the recents list changes, so the Open Recent submenu stays
// current; the rebuild is dispatched to the main thread by the caller.
func installMenu(app *application.App, win *application.WebviewWindow, docs *DocumentService) {
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	file := menu.AddSubmenu("File")
	file.Add("New").SetAccelerator("cmdorctrl+n").OnClick(func(*application.Context) {
		app.Event.Emit("menu:new")
	})
	file.Add("Open…").SetAccelerator("cmdorctrl+o").OnClick(func(*application.Context) {
		app.Event.Emit("menu:open")
	})

	recent := file.AddSubmenu("Open Recent")
	recents := docs.RecentFiles()
	for _, p := range recents {
		path := p
		recent.Add(filepath.Base(path)).OnClick(func(*application.Context) {
			app.Event.Emit("menu:open-recent", path)
		})
	}
	if len(recents) > 0 {
		recent.AddSeparator()
	}
	clearItem := recent.Add("Clear Recents").OnClick(func(*application.Context) {
		docs.ClearRecents()
	})
	if len(recents) == 0 {
		clearItem.SetEnabled(false)
	}

	file.Add("Save").SetAccelerator("cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save")
	})
	file.Add("Save As…").SetAccelerator("shift+cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save-as")
	})
	file.AddSeparator()
	orientation := file.AddSubmenu("PDF Orientation")
	current := docs.PrintOrientation()
	orientation.AddRadio("Portrait", current == "portrait").OnClick(func(*application.Context) {
		docs.SetPrintOrientation("portrait")
	})
	orientation.AddRadio("Landscape", current == "landscape").OnClick(func(*application.Context) {
		docs.SetPrintOrientation("landscape")
	})
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		docs.ExportPDF()
	})

	menu.AddRole(application.EditMenu)
	menu.AddRole(application.WindowMenu)

	app.Menu.SetApplicationMenu(menu)
}
