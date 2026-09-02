//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>

static NSString *const hermesContinuousSpellCheckingKey = @"WebContinuousSpellCheckingEnabled";

// WebKit's TextChecker reads this key with boolForKey: and no registered
// default (Source/WebKit/UIProcess/mac/TextCheckerMac.mm), so a WKWebView
// app starts with continuous checking off. registerDefaults sets the value
// the raw read falls back to without writing anything to disk; a value the
// user later sets through a Spelling menu still wins, because it lands in
// the persistent domain that is consulted first.
static void hermesRegisterSpellCheckingDefaults(void) {
	[[NSUserDefaults standardUserDefaults] registerDefaults:@{hermesContinuousSpellCheckingKey: @YES}];
}

static bool hermesContinuousSpellCheckingDefault(void) {
	return [[NSUserDefaults standardUserDefaults] boolForKey:hermesContinuousSpellCheckingKey];
}
*/
import "C"

// registerSpellCheckingDefaults makes WebKit's continuous spell checking
// read as on for this app. Must run before the webview exists, since the
// text checker reads the key on first use.
func registerSpellCheckingDefaults() {
	C.hermesRegisterSpellCheckingDefaults()
}

// continuousSpellCheckingDefault reads the key back the way WebKit does.
// Exists for the test; nothing else needs it.
func continuousSpellCheckingDefault() bool {
	return bool(C.hermesContinuousSpellCheckingDefault())
}
