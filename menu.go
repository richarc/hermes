package main

import (
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/mac"
)

// installMenu builds and sets the application menu. It is called again
// whenever the recents list changes, so the Open Recent submenu stays
// current; the rebuild is dispatched to the main thread by the caller.
func installMenu(app *application.App, win *application.WebviewWindow, docs *DocumentService) {
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	// ⌘Q used to discard unsaved work: main.go's guard is registered on
	// events.Common.WindowClosing, a *window* event, and quitting never raises
	// one. Route the shortcut through the same confirm the red button uses.
	//
	// Replacing the handler is not enough on its own — see reclaimQuitItem.
	//
	// DocumentService.Quit() deliberately still quits outright: it is what runs
	// *after* the user chooses Save or Don't Save, and sending it back through
	// this confirm would loop.
	if quit := reclaimQuitItem(menu); quit != nil {
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
	current := docs.Settings()
	paper := file.AddSubmenu("Paper Size")
	papers := []struct {
		label string
		value string
	}{
		{"A4", "a4"},
		{"US Letter", "letter"},
	}
	for _, p := range papers {
		value := p.value
		paper.AddRadio(p.label, current.PaperSize == value).OnClick(func(*application.Context) {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the one field it owns.
			next := docs.Settings()
			next.PaperSize = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save paper size: %v", err)
			}
		})
	}
	orientation := file.AddSubmenu("PDF Orientation")
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
	// Export goes through an event rather than calling the service directly:
	// the save dialog offers a filename derived from the document's own path,
	// and only the frontend knows what that path currently is.
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		app.Event.Emit("menu:export-pdf")
	})
	file.Add("Print…").SetAccelerator("cmdorctrl+p").OnClick(func(*application.Context) {
		docs.PrintDocument()
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

	// A submenu rather than a dialog: a code fence is a delimiter and a
	// language name, and the only part carrying value is choosing the language
	// — which a submenu does natively, needing no new UI. Curated rather than
	// the ~150 language-data knows about, which would be unusable as a menu
	// and would need a filter field, i.e. the dialog this avoids.
	//
	// Every token below was checked against loadGrammar's lookup (by name or
	// alias) and resolves. One that did not would insert a block that silently
	// never colours — which is why MATLAB is absent: no grammar ships for it.
	codeBlock := insert.AddSubmenu("Code Block")
	codeLanguages := []struct {
		label string
		token string
	}{
		{"Python", "python"},
		{"R", "r"},
		{"Julia", "julia"},
		{"Fortran", "fortran"},
		{"C++", "c++"},
		{"JavaScript", "javascript"},
		{"Go", "go"},
		{"Rust", "rust"},
		{"Shell", "shell"},
		{"SQL", "sql"},
		{"JSON", "json"},
		{"YAML", "yaml"},
		{"LaTeX", "latex"},
	}
	for _, l := range codeLanguages {
		token := l.token
		codeBlock.Add(l.label).OnClick(func(*application.Context) {
			app.Event.Emit("menu:insert-code", token)
		})
	}
	// Separated for the same reason Paragraph is separated from the headings
	// below: it is the "no language" option, not another language.
	codeBlock.AddSeparator()
	codeBlock.Add("Plain text").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-code", "")
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

	// Wails' HelpMenu role is no use here — it contains a single "Learn More"
	// item pointing at wails.io — so this is built by hand. Both items open in
	// the user's browser rather than in the app: a help document is not a
	// document you are writing, and loading one into the editor would mean
	// replacing whatever is open, guarded by the unsaved-changes confirm, for
	// something the reader only wants to read.
	help := menu.AddSubmenu("Help")
	help.Add("Hermes Documentation").OnClick(func(*application.Context) {
		if err := app.Browser.OpenURL(docsURL); err != nil {
			log.Printf("could not open the documentation: %v", err)
		}
	})
	// The licence texts ride in the bundle because a distributed binary has to
	// carry them — see Taskfile.yml's bundle:licences. Reachable from here so
	// they are not only discoverable by way of Show Package Contents.
	help.Add("Licences").OnClick(func(*application.Context) {
		// OpenFile, not OpenURL with a file:// URL. Both end at
		// exec.Command("open", target), so a plain path is handed straight to
		// `open` with no shell in between — where a hand-built file:// URL
		// would carry a raw space from "Hermes Editor.app" and be malformed.
		// Worth knowing when debugging either: the implementation discards the
		// result of `open` in a goroutine, so a bad target fails silently and
		// only a failure to *start* `open` is ever returned.
		if resources, err := mac.ResourcePath(); err == nil {
			if dir, ok := licencesPath(resources); ok {
				if err := app.Browser.OpenFile(dir); err != nil {
					log.Printf("could not open the licences: %v", err)
				}
				return
			}
		}
		// Unbundled there is nothing to open — `go run`, or the bare binary —
		// so fall back to the repository rather than doing nothing.
		if err := app.Browser.OpenURL(docsURL); err != nil {
			log.Printf("could not open the licences: %v", err)
		}
	})
	help.AddSeparator()
	// No accelerator: an invented chord cannot be checked against every macOS
	// binding — the same reasoning as Blockquote and Insert → Chart….
	help.Add("Report an Issue…").OnClick(func(*application.Context) {
		env := app.Env.Info()
		osName, osVersion := env.OS, ""
		if env.OSInfo != nil {
			// Branding is the marketing name ("macOS Tahoe") where a platform
			// supplies one; OS is the bare identifier. Prefer the former.
			if env.OSInfo.Branding != "" {
				osName = env.OSInfo.Branding
			}
			osVersion = env.OSInfo.Version
		}
		if err := app.Browser.OpenURL(feedbackURL(appVersion(), osName, osVersion)); err != nil {
			log.Printf("could not open the feedback form: %v", err)
		}
	})

	app.Menu.SetApplicationMenu(menu)
}

// reclaimQuitItem takes the App menu's Quit item back from AppKit so a Go
// handler can run on it, and returns it — or nil if there is no Quit item.
//
// Attaching OnClick alone does nothing, which is how the first attempt at this
// fix shipped without working. Wails builds a role-based item with the role's
// native selector and target=nil (menuitem_selectors_darwin.go maps Quit to
// "terminate:"), so AppKit sends the action up the responder chain to NSApp
// and the callback is never invoked. Clearing the role drops the selector,
// which puts the item back on the ordinary handleClick path. The label and the
// ⌘Q accelerator are properties of the item, not the role, so both survive.
func reclaimQuitItem(menu *application.Menu) *application.MenuItem {
	quit := menu.FindByRole(application.Quit)
	if quit == nil {
		return nil
	}
	return quit.SetRole(application.NoRole)
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
