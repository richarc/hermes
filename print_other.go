//go:build !darwin

package main

// printWithOrientation reports false off macOS so the caller falls back to
// the default Wails print path; other platforms' print dialogs manage
// orientation themselves.
func printWithOrientation(landscape bool) bool { return false }

// exportPDF reports false off macOS: the panel-free export is an AppKit
// NSPrintOperation, and there is no equivalent here. The caller surfaces the
// failure to the user rather than writing an empty file.
func exportPDF(path, paperName string, landscape bool, paperWidth, paperHeight float64) bool {
	return false
}
