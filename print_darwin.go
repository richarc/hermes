//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

static void hermesSetPrintOrientation(int landscape) {
	NSPrintInfo *info = [NSPrintInfo sharedPrintInfo];
	info.orientation = landscape ? NSPaperOrientationLandscape
	                             : NSPaperOrientationPortrait;
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// applyPrintOrientation primes the shared NSPrintInfo before a print
// operation. Wails' WebviewWindow.Print() hands WebKit the shared print
// info, and WebKit ignores CSS @page orientation, so this is the only
// hook for a default orientation. Runs on the main thread (AppKit rule).
func applyPrintOrientation(landscape bool) {
	l := C.int(0)
	if landscape {
		l = 1
	}
	application.InvokeSync(func() {
		C.hermesSetPrintOrientation(l)
	})
}
