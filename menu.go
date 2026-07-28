package main

import "github.com/wailsapp/wails/v3/pkg/application"

func setupMenu(app *application.App, win *application.WebviewWindow) {
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	file := menu.AddSubmenu("File")
	file.Add("Open…").SetAccelerator("cmdorctrl+o").OnClick(func(*application.Context) {
		app.Event.Emit("menu:open")
	})
	file.Add("Save").SetAccelerator("cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save")
	})
	file.Add("Save As…").SetAccelerator("shift+cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save-as")
	})
	file.AddSeparator()
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		_ = win.Print()
	})

	menu.AddRole(application.EditMenu)
	menu.AddRole(application.WindowMenu)

	app.Menu.SetApplicationMenu(menu)
}
