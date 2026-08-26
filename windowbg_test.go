package main

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The window's BackgroundColour is a second copy of the --bg palette token,
// written in Go because the webview's stylesheet is not readable from here.
// Nothing connected the two, and they drifted twice — the window flashing the
// old colour for the frame before the webview paints, which is exactly the
// kind of defect that survives review because it is over before you focus on
// it. These tests are the connection.
//
// They read the stylesheet rather than a copy of it, so the failure lands on
// whoever edits the palette, in the same commit, rather than on the next
// person to look closely at a launch.

const stylesheet = "frontend/public/style.css"

// bgIn returns the --bg declared by the palette block introduced by selector.
//
// Scoped to one block rather than matched across the file because both blocks
// declare the same name — the whole point of the palette — so an unscoped
// search would silently test the light value twice.
func bgIn(t *testing.T, css, selector string) string {
	t.Helper()

	start := strings.Index(css, selector)
	if start < 0 {
		t.Fatalf("no %s block in %s", selector, stylesheet)
	}
	end := strings.Index(css[start:], "\n}")
	if end < 0 {
		t.Fatalf("%s block in %s is never closed", selector, stylesheet)
	}

	// Anchored to the start of a line so it cannot match --overlay-bg or any
	// other token that happens to end in "-bg".
	m := regexp.MustCompile(`(?m)^\s*--bg:\s*(#[0-9a-fA-F]{6})\s*;`).FindStringSubmatch(css[start : start+end])
	if m == nil {
		t.Fatalf("%s declares no --bg in %s", selector, stylesheet)
	}
	return m[1]
}

// parseHex turns "#1f1f1f" into the RGBA the window options want, so the
// comparison happens in one representation instead of by eye.
func parseHex(t *testing.T, hex string) application.RGBA {
	t.Helper()

	var c [3]uint8
	for i := range c {
		n, err := strconv.ParseUint(hex[1+i*2:3+i*2], 16, 8)
		if err != nil {
			t.Fatalf("parsing %q: %v", hex, err)
		}
		c[i] = uint8(n)
	}
	return application.NewRGB(c[0], c[1], c[2])
}

func readStylesheet(t *testing.T) string {
	t.Helper()

	css, err := os.ReadFile(stylesheet)
	if err != nil {
		t.Fatalf("reading %s: %v", stylesheet, err)
	}
	return string(css)
}

func TestWindowBackgroundMatchesPalette(t *testing.T) {
	css := readStylesheet(t)

	for _, tc := range []struct {
		name     string
		selector string
		want     application.RGBA
	}{
		{"light", ":root {", lightWindowBg},
		{"dark", `:root[data-theme="dark"] {`, darkWindowBg},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hex := bgIn(t, css, tc.selector)
			if got := parseHex(t, hex); got != tc.want {
				t.Errorf("style.css %s has --bg: %s (%v), main.go has %v — change both or neither", tc.selector, hex, got, tc.want)
			}
		})
	}
}

// The setting is a three-way choice and only one of its values is dark, so the
// mapping is worth pinning: an empty string reaching this (a settings file
// written by an older build, say) must land on light rather than on whatever
// the zero value happens to select.
func TestWindowBackgroundForTheme(t *testing.T) {
	for _, tc := range []struct {
		theme string
		want  application.RGBA
	}{
		{"dark", darkWindowBg},
		{"light", lightWindowBg},
		{"system", lightWindowBg},
		{"", lightWindowBg},
	} {
		if got := windowBackground(tc.theme); got != tc.want {
			t.Errorf("windowBackground(%q) = %v, want %v", tc.theme, got, tc.want)
		}
	}
}
