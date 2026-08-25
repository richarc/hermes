//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <stdlib.h>

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

		// Run the panel BEFORE building the operation.
		//
		// This ordering is the whole fix. Wails (and our first version) created
		// the operation first, which makes WKPrintingView paginate against the
		// print info we supplied; the panel then replaced paper size and
		// imageable area with the chosen printer's, the content reflowed to
		// need more room, and the operation still rendered only the pages it
		// had originally counted. An 11-page count applied to a now-longer
		// document silently dropped the tail — a bibliography ending four
		// entries early. Paginating after the settings are final cannot go
		// stale, because there is nothing left to change.
		//
		// The cost is the panel's live preview, which is drawn BY the print
		// operation — with no operation yet created there is nothing to draw
		// it from, and asking for NSPrintPanelShowsPreview on a standalone
		// panel does nothing (verified). That is the trade: no preview inside
		// the panel, in exchange for a PDF that contains the whole document.
		// The panel's PDF menu still offers Open in Preview.
		NSPrintPanel *panel = [NSPrintPanel printPanel];
		if ([panel runModalWithPrintInfo:pInfo] != NSModalResponseOK) {
			return 1; // cancelled
		}

		NSPrintOperation *po = [webView printOperationWithPrintInfo:pInfo];
		po.showsPrintPanel = NO; // already shown, above
		po.showsProgressPanel = YES;
		[po runOperationModalForWindow:window
		                      delegate:nil
		                didRunSelector:nil
		                   contextInfo:nil];
		return 1;
	}
	return 0;
}

// Renders the frontmost window's webview straight to a PDF at `path`, with no
// print panel.
//
// The ordering hazard documented on hermesPrintWebView does not apply here,
// and that is the reason this function exists rather than reusing that one.
// There, the panel substitutes the chosen printer's paper size after
// WKPrintingView has already counted pages, and the operation renders a page
// count that no longer matches the reflowed content — which silently dropped
// the tail of long documents. Here the print info is final before the
// operation is built, because nothing is ever given the chance to change it:
// the paper comes from the Paper Size setting the preview's sheet is already
// drawn at, and no dialog stands between that and the pagination.
//
// Margins are zero on purpose. The CSS @page rule supplies the 25mm page
// margin, and NSPrintInfo's margins compound with it rather than replacing
// it — a non-zero value here would be added to the CSS margin and every
// export would come out with margins roughly double what the sheet drew.
//
// Returns 0 if the webview could not be located.
static int hermesExportWebViewPDF(const char *path, const char *paperName,
                                  int landscape, double paperWidth,
                                  double paperHeight) {
	if (@available(macOS 11.0, *)) {
		NSWindow *window = [NSApp keyWindow] ?: [NSApp mainWindow];
		if (!window) {
			return 0;
		}
		WKWebView *webView = hermesFindWebView(window.contentView);
		if (!webView) {
			return 0;
		}

		NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];

		NSPrintInfo *pInfo = [[NSPrintInfo sharedPrintInfo] copy];
		pInfo.horizontalPagination = NSPrintingPaginationModeAutomatic;
		pInfo.verticalPagination = NSPrintingPaginationModeAutomatic;
		// paperName BEFORE paperSize, and do not tidy these two lines into the
		// other order.
		//
		// The copy inherits both NSPrintPaperName and NSPrintPaperSize from the
		// shared print info, which is seeded from the default printer. Setting
		// only the size can leave a name behind that names a different paper —
		// a user whose default printer is US Letter, exporting at A4, would
		// carry a stale "na-letter" into any AppKit path that re-derives the
		// size from the name, and get a Letter PDF whose measure disagrees with
		// the sheet they wrote against. That is exactly the second-source-of-
		// truth bug this whole export path exists to eliminate, and it stays
		// invisible until a journal portal rejects the page size. So the name
		// is set explicitly rather than left to be inferred.
		//
		// The order matters because -setPaperName: also resets paperSize to
		// that paper's canonical size — measured: setting "iso-a4" yields
		// 595.00 x 842.00, the rounded catalogue figure, not the 595.28 x
		// 841.89 the sheet is drawn at. Name first establishes the paper;
		// size second pins the exact dimensions. Reversed, the name would
		// overwrite the size we just asked for. An unrecognised name is a
		// silent no-op (measured — it does not raise), and paperPoints only
		// ever pairs a name with its own dimensions, so the two cannot drift.
		pInfo.paperName = [NSString stringWithUTF8String:paperName];
		pInfo.paperSize = NSMakeSize(paperWidth, paperHeight);
		pInfo.orientation = landscape ? NSPaperOrientationLandscape
		                              : NSPaperOrientationPortrait;
		// Both default to YES, and both are inherited from the shared print
		// info — which carries whatever the user's last print job happened to
		// leave on it. Left alone, a short final page is centred vertically in
		// its paper instead of starting at the top margin: a defect that looks
		// deliberate in the finished PDF, that the sheet never showed, and that
		// differs between two machines exporting the same document. Every other
		// setting on this print info is pinned for the same reason; these two
		// are the ones easiest to forget, because their wrong value is also
		// their default. hermesPrintWebView above sets them YES deliberately —
		// that is an interactive print through the panel, where the user is
		// choosing the placement; this is an artefact, and nothing outside the
		// document may decide what is in it.
		pInfo.verticallyCentered = NO;
		pInfo.horizontallyCentered = NO;
		pInfo.leftMargin = 0;
		pInfo.rightMargin = 0;
		pInfo.topMargin = 0;
		pInfo.bottomMargin = 0;
		pInfo.jobDisposition = NSPrintSaveJob;
		[pInfo.dictionary setObject:url forKey:NSPrintJobSavingURL];

		NSPrintOperation *po = [webView printOperationWithPrintInfo:pInfo];
		po.showsPrintPanel = NO;
		po.showsProgressPanel = YES;
		// runOperationModalForWindow, not runOperation: WKPrintingView needs
		// the runloop to service the web content process, and [po runOperation]
		// deadlocks on the main thread.
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

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

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

// exportPDF renders the webview to a PDF at path with no print panel, so the
// paper the sheet was drawn at is the paper the export uses. paperName is the
// PWG name of that paper ("iso-a4", "na-letter"), which must agree with the
// dimensions — see the ordering note in hermesExportWebViewPDF.
//
// The returned bool means "the webview was found and the operation was
// started", NOT "the PDF was written". runOperationModalForWindow: is
// document-modal: it returns as soon as the sheet is on screen, long before a
// byte reaches disk, so a read-only volume or a sandbox denial produces no
// file, no error here, and nothing for the caller to tell the user about.
// That limitation is inherited from the print path, which has the same shape;
// reporting a real write failure would mean taking the didRunSelector
// callback and plumbing the result back across the cgo boundary.
func exportPDF(path, paperName string, landscape bool, paperWidth, paperHeight float64) bool {
	l := C.int(0)
	if landscape {
		l = 1
	}
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	cName := C.CString(paperName)
	defer C.free(unsafe.Pointer(cName))
	return application.InvokeSyncWithResult(func() bool {
		return C.hermesExportWebViewPDF(cPath, cName, l, C.double(paperWidth), C.double(paperHeight)) != 0
	})
}
