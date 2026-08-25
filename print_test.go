package main

import "testing"

func TestPaperPointsCoversBothPapersAndOrientations(t *testing.T) {
	cases := []struct {
		size      string
		landscape bool
		w, h      float64
	}{
		{"a4", false, 595.28, 841.89},
		{"a4", true, 841.89, 595.28},
		{"letter", false, 612, 792},
		{"letter", true, 792, 612},
		// An unknown paper falls back to A4 rather than to zero, which would
		// produce a PDF with no imageable area at all.
		{"foolscap", false, 595.28, 841.89},
	}
	for _, c := range cases {
		w, h := paperPoints(c.size, c.landscape)
		if w != c.w || h != c.h {
			t.Errorf("paperPoints(%q, %v) = %v x %v, want %v x %v",
				c.size, c.landscape, w, h, c.w, c.h)
		}
	}
}

func TestPDFExportFilenameSwapsTheExtension(t *testing.T) {
	cases := map[string]string{
		"/Users/x/Papers/thesis.md":      "thesis.pdf",
		"/Users/x/Papers/notes.markdown": "notes.pdf",
		"/Users/x/Papers/no-extension":   "no-extension.pdf",
		"/Users/x/Papers/dotted.name.md": "dotted.name.pdf",
		// An unsaved document has no path at all; the dialog still needs a
		// name to offer.
		"": "untitled.pdf",
	}
	for in, want := range cases {
		if got := pdfExportFilename(in); got != want {
			t.Errorf("pdfExportFilename(%q) = %q, want %q", in, got, want)
		}
	}
}
