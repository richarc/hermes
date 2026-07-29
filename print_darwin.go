//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static WKWebView* hermesFindWebView(NSView *view) {
	if ([view isKindOfClass:[WKWebView class]]) {
		return (WKWebView *)view;
	}
	for (NSView *sub in view.subviews) {
		WKWebView *found = hermesFindWebView(sub);
		if (found) {
			return found;
		}
	}
	return nil;
}

// Runs a print operation over the frontmost window's webview with an
// explicit orientation. Returns 0 if the webview could not be located
// (caller falls back to the default print path).
static int hermesPrintWebView(int landscape) {
	if (@available(macOS 11.0, *)) {
		NSWindow *window = [NSApp keyWindow] ?: [NSApp mainWindow];
		if (!window) {
			return 0;
		}
		WKWebView *webView = hermesFindWebView(window.contentView);
		if (!webView) {
			return 0;
		}

		NSPrintInfo *pInfo = [[NSPrintInfo sharedPrintInfo] copy];
		pInfo.horizontalPagination = NSPrintingPaginationModeAutomatic;
		pInfo.verticalPagination = NSPrintingPaginationModeAutomatic;
		pInfo.verticallyCentered = YES;
		pInfo.horizontallyCentered = YES;
		pInfo.orientation = landscape ? NSPaperOrientationLandscape
		                              : NSPaperOrientationPortrait;
		pInfo.leftMargin = 30;
		pInfo.rightMargin = 30;
		pInfo.topMargin = 30;
		pInfo.bottomMargin = 30;

		NSPrintOperation *po = [webView printOperationWithPrintInfo:pInfo];
		po.showsPrintPanel = YES;
		po.showsProgressPanel = YES;
		po.view.frame = webView.bounds;
		[po runOperationModalForWindow:window
		                      delegate:nil
		                didRunSelector:nil
		                   contextInfo:nil];
		return 1;
	}
	return 0;
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// printWithOrientation runs our own print operation because Wails'
// WebviewWindow.Print() hardcodes landscape orientation (NSPaperOrientation
// is set inside its windowPrint C function, overriding anything primed on
// the shared NSPrintInfo). Mirrors the Wails implementation otherwise.
// Returns false if the webview wasn't found so the caller can fall back.
func printWithOrientation(landscape bool) bool {
	l := C.int(0)
	if landscape {
		l = 1
	}
	return application.InvokeSyncWithResult(func() bool {
		return C.hermesPrintWebView(l) != 0
	})
}
