package main

import (
	"math"
	"os"
	"regexp"
	"strconv"
	"testing"
)

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

// The name and the dimensions are set on the same NSPrintInfo and must agree:
// -setPaperName: resets the size to that paper's canonical figures, so a name
// that disagreed with paperPoints would silently resize the page.
func TestPaperPWGNameAgreesWithPaperPoints(t *testing.T) {
	cases := map[string]string{
		"letter": "na-letter",
		"a4":     "iso-a4",
		// Unknown papers fall back to A4 in paperPoints, so the name has to
		// fall back with them rather than to letter or to an empty string.
		"foolscap": "iso-a4",
		"":         "iso-a4",
	}
	for in, want := range cases {
		if got := paperPWGName(in); got != want {
			t.Errorf("paperPWGName(%q) = %q, want %q", in, got, want)
		}
	}
}

// paperPoints and paperPWGName restate, in points, a paper table that also
// exists in millimetres in frontend/src/lib/paper.ts — where it decides how
// wide the preview draws the sheet. Two hand-maintained copies of the same
// physical fact, in different units, on opposite sides of the Go/TS boundary:
// each was guarded only against itself, so a paper added or corrected in one
// would have left the sheet and the PDF measuring different pages with every
// test still green. That is precisely the divergence the export path exists
// to prevent, so the two are compared here rather than trusted.
//
// The comparison is done in millimetres, with the points value converted back
// and required to round to the whole millimetre the TS table states. That is
// the exact tolerance the catalogue rounding needs and no more: US Letter is
// 612 x 792 pt, which is 215.9 x 279.4 mm, and paper.ts rounds those to
// 216 x 279 — a discrepancy of up to 1.4 pt that is real and correct. Any
// error large enough to matter (a transposed dimension, A4 read as Letter, a
// portrait table used for landscape) moves a dimension by tens of points and
// still fails.
func TestPaperPointsAgreesWithTheFrontendPaperTable(t *testing.T) {
	const mmPerPoint = 25.4 / 72.0

	table := readPaperMM(t)
	// A size present in paper.ts that Go has never heard of would silently
	// fall back to A4 in paperPoints and go unnoticed; the frontend would draw
	// the sheet at the new paper and the PDF would come out A4. So the two
	// tables must list the same papers, not merely agree about the ones Go
	// happens to know.
	if len(table) != 2 {
		t.Fatalf("paper.ts lists %d papers (%v); paperPoints and paperPWGName in "+
			"documentservice.go know only a4 and letter and must be taught the rest",
			len(table), table)
	}

	wantNames := map[string]string{"a4": "iso-a4", "letter": "na-letter"}
	for size, mm := range table {
		name, known := wantNames[size]
		if !known {
			t.Errorf("paper.ts has paper %q with no Go counterpart", size)
			continue
		}
		if got := paperPWGName(size); got != name {
			t.Errorf("paperPWGName(%q) = %q, want %q", size, got, name)
		}

		// Portrait puts the short edge across the page, landscape the long
		// one; the frontend's sheetWidthMm makes the same choice, and a
		// disagreement here would be a sheet drawn at one aspect and a PDF
		// printed at the other.
		for _, c := range []struct {
			landscape bool
			wantW     float64
			wantH     float64
		}{
			{false, mm.short, mm.long},
			{true, mm.long, mm.short},
		} {
			wPt, hPt := paperPoints(size, c.landscape)
			for _, d := range []struct {
				axis string
				pt   float64
				want float64
			}{
				{"width", wPt, c.wantW},
				{"height", hPt, c.wantH},
			} {
				gotMM := d.pt * mmPerPoint
				if math.Abs(gotMM-d.want) > 0.5 {
					t.Errorf("paperPoints(%q, landscape=%v) %s = %.2fpt = %.2fmm; "+
						"paper.ts says %.0fmm", size, c.landscape, d.axis,
						d.pt, gotMM, d.want)
				}
			}
		}
	}
}

// readPaperMM parses the PAPER_MM table out of frontend/src/lib/paper.ts. It
// is read rather than duplicated because a copy of the table in this file
// would be a third source of truth, which is the disease and not the cure.
func readPaperMM(t *testing.T) map[string]struct{ short, long float64 } {
	t.Helper()
	src, err := os.ReadFile("frontend/src/lib/paper.ts")
	if err != nil {
		t.Fatalf("reading paper.ts: %v", err)
	}
	body := regexp.MustCompile(`(?s)PAPER_MM[^{]*\{(.*?)\n\}`).FindSubmatch(src)
	if body == nil {
		t.Fatal("could not find the PAPER_MM table in paper.ts; if it was " +
			"renamed or reshaped, this cross-check needs updating rather than deleting")
	}
	entry := regexp.MustCompile(`(\w+):\s*\{\s*short:\s*([0-9.]+),\s*long:\s*([0-9.]+)\s*\}`)
	out := map[string]struct{ short, long float64 }{}
	for _, m := range entry.FindAllSubmatch(body[1], -1) {
		short, err := strconv.ParseFloat(string(m[2]), 64)
		if err != nil {
			t.Fatalf("parsing short edge for %s: %v", m[1], err)
		}
		long, err := strconv.ParseFloat(string(m[3]), 64)
		if err != nil {
			t.Fatalf("parsing long edge for %s: %v", m[1], err)
		}
		out[string(m[1])] = struct{ short, long float64 }{short, long}
	}
	if len(out) == 0 {
		t.Fatal("parsed no papers out of PAPER_MM")
	}
	return out
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
