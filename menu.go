package main

import (
	"log"
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

	file.Add("Insert Citation…").SetAccelerator("shift+cmdorctrl+c").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-citation")
	})

	file.Add("Save").SetAccelerator("cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save")
	})
	file.Add("Save As…").SetAccelerator("shift+cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save-as")
	})
	file.AddSeparator()
	orientation := file.AddSubmenu("PDF Orientation")
	current := docs.Settings()
	orientations := []struct {
		label string
		value string
	}{
		{"Portrait", "portrait"},
		{"Landscape", "landscape"},
	}
	for _, o := range orientations {
		value := o.value
		orientation.AddRadio(o.label, current.PrintOrientation == value).OnClick(func(*application.Context) {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the one field it owns.
			next := docs.Settings()
			next.PrintOrientation = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save PDF orientation: %v", err)
			}
		})
	}
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		docs.ExportPDF()
	})

	menu.AddRole(application.EditMenu)

	format := menu.AddSubmenu("Format")
	heading := format.AddSubmenu("Heading")
	headings := []struct {
		label string
		key   string
		arg   string
	}{
		{"Heading 1", "cmdorctrl+1", "heading:1"},
		{"Heading 2", "cmdorctrl+2", "heading:2"},
		{"Heading 3", "cmdorctrl+3", "heading:3"},
		{"Heading 4", "cmdorctrl+4", "heading:4"},
		{"Heading 5", "cmdorctrl+5", "heading:5"},
		{"Heading 6", "cmdorctrl+6", "heading:6"},
	}
	for _, h := range headings {
		arg := h.arg
		heading.Add(h.label).SetAccelerator(h.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:format", arg)
		})
	}
	heading.AddSeparator()
	heading.Add("Paragraph").SetAccelerator("cmdorctrl+0").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "heading:0")
	})

	format.AddSeparator()
	inline := []struct {
		label string
		key   string
		arg   string
	}{
		{"Bold", "cmdorctrl+b", "bold"},
		{"Italic", "cmdorctrl+i", "italic"},
		{"Inline Code", "shift+cmdorctrl+k", "code"},
		{"Strikethrough", "shift+cmdorctrl+x", "strike"},
	}
	for _, it := range inline {
		arg := it.arg
		format.Add(it.label).SetAccelerator(it.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:format", arg)
		})
	}

	format.AddSeparator()
	format.Add("Bulleted List").SetAccelerator("shift+cmdorctrl+8").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "bullet")
	})
	format.Add("Numbered List").SetAccelerator("shift+cmdorctrl+7").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "ordered")
	})
	// Blockquote deliberately has no accelerator: the punctuation chords are
	// not worth guessing at, and the menu item is the discoverable route.
	format.Add("Blockquote").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "quote")
	})

	view := menu.AddSubmenu("View")
	// No accelerator: the obvious chords are taken, and this is not a frequent
	// action — the same reasoning as Blockquote in the Format menu.
	view.AddCheckbox("Sync Scrolling", current.SyncScrolling).OnClick(func(*application.Context) {
		next := docs.Settings()
		next.SyncScrolling = !next.SyncScrolling
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save sync scrolling: %v", err)
		}
	})

	menu.AddRole(application.WindowMenu)

	app.Menu.SetApplicationMenu(menu)
}
