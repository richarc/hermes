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

	// The AppMenu role wires Quit straight to application.Quit(), which is
	// InvokeSync(impl.destroy) — it tears the app down without ever
	// dispatching events.Common.WindowClosing. main.go's unsaved-changes guard
	// is registered on exactly that event, so ⌘Q bypassed it and discarded the
	// document while the red button and ⌘W prompted correctly. Replace the
	// role's handler so the shortcut goes through the same confirm.
	//
	// DocumentService.Quit() deliberately still calls application.Quit()
	// directly: it is what runs *after* the user chooses Save or Don't Save,
	// and routing it back through here would loop.
	if quit := menu.FindByRole(application.Quit); quit != nil {
		quit.OnClick(func(*application.Context) {
			quitRequest(docs.IsDirty(),
				func() { app.Event.Emit("close:confirm") },
				app.Quit)
		})
	}

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

	insert := menu.AddSubmenu("Insert")
	insert.Add("Citation…").SetAccelerator("shift+cmdorctrl+c").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-citation", nil)
	})
	// No accelerator: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	insert.Add("Chart…").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-chart", nil)
	})

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
	// Read locally rather than reusing the `current` from the File-menu block
	// above: the two are built 85 lines apart, and a future reorder could
	// separate the read from this use without anything catching it.
	viewCurrent := docs.Settings()
	// No accelerator: the obvious chords are taken, and this is not a frequent
	// action — the same reasoning as Blockquote in the Format menu.
	view.AddCheckbox("Sync Scrolling", viewCurrent.SyncScrolling).OnClick(func(*application.Context) {
		next := docs.Settings()
		next.SyncScrolling = !next.SyncScrolling
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save sync scrolling: %v", err)
		}
	})

	view.AddSeparator()
	appearance := view.AddSubmenu("Appearance")
	themes := []struct {
		label string
		value string
	}{
		{"System", "system"},
		{"Light", "light"},
		{"Dark", "dark"},
	}
	for _, t := range themes {
		value := t.value
		appearance.AddRadio(t.label, viewCurrent.Theme == value).OnClick(func(*application.Context) {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the field it owns.
			next := docs.Settings()
			next.Theme = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save theme: %v", err)
			}
		})
	}

	// Both read viewCurrent, the settings snapshot taken at the top of this
	// View block. Each OnClick re-reads and read-modify-writes the whole
	// value, so a submenu only ever changes the one field it owns.
	alignmentMenu := view.AddSubmenu("Figure Alignment")
	alignments := []struct {
		label string
		value string
	}{
		{"Left", "left"},
		{"Centre", "centre"},
		{"Right", "right"},
	}
	for _, a := range alignments {
		value := a.value
		alignmentMenu.AddRadio(a.label, viewCurrent.FigureAlignment == value).OnClick(func(*application.Context) {
			next := docs.Settings()
			next.FigureAlignment = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save figure alignment: %v", err)
			}
		})
	}

	widthMenu := view.AddSubmenu("Chart Width")
	widths := []struct {
		label string
		value string
	}{
		{"Small", "small"},
		{"Medium", "medium"},
		{"Large", "large"},
	}
	for _, w := range widths {
		value := w.value
		widthMenu.AddRadio(w.label, viewCurrent.ChartWidth == value).OnClick(func(*application.Context) {
			next := docs.Settings()
			next.ChartWidth = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save chart width: %v", err)
			}
		})
	}

	view.AddSeparator()
	// ⌘⌥[ and ⌘⌥] already fold and unfold the block at the cursor — CodeMirror's
	// foldKeymap binds them, and the webview sees them before AppKit does. These
	// items exist to make that discoverable; the accelerators shown here are
	// reflecting what already happens, not claiming it.
	folds := []struct {
		label string
		key   string
		arg   string
	}{
		{"Fold Block", "cmdorctrl+alt+[", "fold-block"},
		{"Unfold Block", "cmdorctrl+alt+]", "unfold-block"},
	}
	for _, f := range folds {
		arg := f.arg
		view.Add(f.label).SetAccelerator(f.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:fold", arg)
		})
	}

	view.AddSeparator()
	// No accelerators: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	view.Add("Fold All Code Blocks").OnClick(func(*application.Context) {
		app.Event.Emit("menu:fold", "fold-all-code")
	})
	view.Add("Unfold All").OnClick(func(*application.Context) {
		app.Event.Emit("menu:fold", "unfold-all")
	})

	menu.AddRole(application.WindowMenu)

	app.Menu.SetApplicationMenu(menu)
}

// quitRequest decides what ⌘Q does: raise the unsaved-changes confirm, or
// quit. Split out from the menu closure so the branch is reachable by a test —
// getting it the wrong way round silently discards the user's document, and
// AppKit menu construction cannot be exercised headlessly.
func quitRequest(dirty bool, confirm func(), quit func()) {
	if dirty {
		confirm()
		return
	}
	quit()
}
