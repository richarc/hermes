//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>
#include <stdlib.h>

// Returns CFBundleShortVersionString, or NULL when there is no bundle —
// which is the case for a bare binary run from `go run` or the build output.
static char* hermesBundleVersion(void) {
	NSString *v = [[NSBundle mainBundle]
		objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
	if (v == nil) {
		return NULL;
	}
	return strdup([v UTF8String]);
}
*/
import "C"
import "unsafe"

// appVersion reads the version out of the running application bundle.
//
// Deliberately not a Go constant. The version already lives in
// build/config.yml, which generates Info.plist, and a third copy compiled in
// here would be one more thing to keep in step with a git tag — the same class
// of drift that left the README advertising a Wails version seven releases
// behind. Reading it back means config.yml stays the single source.
//
// Empty when the binary is not in a bundle; feedbackURL turns that into
// "unknown" rather than sending a blank field.
func appVersion() string {
	c := C.hermesBundleVersion()
	if c == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(c))
	return C.GoString(c)
}
