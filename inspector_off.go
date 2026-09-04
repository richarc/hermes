//go:build !darwin || production

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// enableInspector is a no-op outside macOS dev builds. See inspector_darwin.go.
func enableInspector(*application.WebviewWindow) {}
