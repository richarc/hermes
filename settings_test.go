package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaults(t *testing.T) {
	s := newTestService(t)
	if got := s.Settings().PrintOrientation; got != "portrait" {
		t.Errorf("want portrait default, got %q", got)
	}
}

func TestUpdateSettingsPersistsAcrossInstances(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.PrintOrientation = "landscape"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got := s.Settings().PrintOrientation; got != "landscape" {
		t.Errorf("want landscape after update, got %q", got)
	}

	// A fresh service over the same path reads the persisted value.
	if got := NewDocumentService(recentsPath).Settings().PrintOrientation; got != "landscape" {
		t.Errorf("want persisted landscape in a new service, got %q", got)
	}
}

func TestUpdateSettingsNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{PrintOrientation: "diagonal"}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got := s.Settings().PrintOrientation; got != "portrait" {
		t.Errorf("an unknown value must fall back to the default, got %q", got)
	}
}

func TestUpdateSettingsNotifiesOnlyOnRealChange(t *testing.T) {
	s := newTestService(t)
	fired := 0
	s.settings.onChanged = func() { fired++ }

	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape"}); err != nil {
		t.Fatal(err)
	}
	if fired != 1 {
		t.Fatalf("want one notification on change, fired=%d", fired)
	}

	// Re-applying the same value changes nothing, so nothing should rebuild.
	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape"}); err != nil {
		t.Fatal(err)
	}
	if fired != 1 {
		t.Errorf("an unchanged update must not notify, fired=%d", fired)
	}

	// An invalid value normalises back to the current default, which for a
	// store already on landscape *is* a change — back to portrait.
	if err := s.UpdateSettings(Settings{PrintOrientation: "sideways"}); err != nil {
		t.Fatal(err)
	}
	if got := s.Settings().PrintOrientation; got != "portrait" {
		t.Errorf("want normalised portrait, got %q", got)
	}
	if fired != 2 {
		t.Errorf("want a notification for the normalised change, fired=%d", fired)
	}
}

func TestSettingsFallsBackWhenFileIsUnreadable(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"corrupt json", "{not json"},
		{"empty object", "{}"},
		{"null", "null"},
		{"unknown value on disk", `{"printOrientation":"diagonal"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(tc.content), 0o644); err != nil {
				t.Fatal(err)
			}
			s := NewDocumentService(filepath.Join(dir, "recents.json"))
			if got := s.Settings().PrintOrientation; got != "portrait" {
				t.Errorf("want portrait fallback, got %q", got)
			}
		})
	}
}

func TestSettingsKeepsUnknownKeysFromBreakingLoad(t *testing.T) {
	// A settings file written by a newer version must not lose the keys this
	// version does understand.
	dir := t.TempDir()
	body := `{"printOrientation":"landscape","somethingFromTheFuture":42}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewDocumentService(filepath.Join(dir, "recents.json"))
	if got := s.Settings().PrintOrientation; got != "landscape" {
		t.Errorf("want landscape, got %q", got)
	}
}

func TestUpdateSettingsReportsAWriteFailure(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}
	dir := t.TempDir()
	s := NewDocumentService(filepath.Join(dir, "recents.json"))
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	// Silently dropping this is what the old SetPrintOrientation did; the
	// caller now gets to know the preference did not stick.
	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape"}); err == nil {
		t.Error("want an error when the settings file cannot be written")
	}
}

func TestSettingsAreReadWithoutTouchingDiskTwice(t *testing.T) {
	// The store loads once and serves from memory, so deleting the file behind
	// its back does not change what it reports.
	dir := t.TempDir()
	s := NewDocumentService(filepath.Join(dir, "recents.json"))
	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	if got := s.Settings().PrintOrientation; got != "landscape" {
		t.Errorf("want the in-memory value, got %q", got)
	}
}

func TestSyncScrollingDefaultsToOff(t *testing.T) {
	s := newTestService(t)
	if s.Settings().SyncScrolling {
		t.Error("want sync scrolling off by default")
	}
}

func TestSyncScrollingPersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.SyncScrolling = true
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if !NewDocumentService(recentsPath).Settings().SyncScrolling {
		t.Error("want sync scrolling persisted across instances")
	}
}

func TestSyncScrollingIsIndependentOfOrientation(t *testing.T) {
	// The two settings share one struct and one file; changing either must not
	// disturb the other.
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape", SyncScrolling: true}); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling {
		t.Errorf("got %+v", got)
	}

	next := got
	next.SyncScrolling = false
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if s.Settings().PrintOrientation != "landscape" {
		t.Error("toggling sync scrolling disturbed the orientation")
	}
}

func TestThemeDefaultsToSystem(t *testing.T) {
	s := newTestService(t)
	if got := s.Settings().Theme; got != "system" {
		t.Errorf("want system default, got %q", got)
	}
}

func TestThemePersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.Theme = "dark"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got := NewDocumentService(recentsPath).Settings().Theme; got != "dark" {
		t.Errorf("want dark persisted, got %q", got)
	}
}

func TestThemeNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "solarized", "DARK", "auto"} {
		if err := s.UpdateSettings(Settings{Theme: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().Theme; got != "system" {
			t.Errorf("want %q normalised to system, got %q", bad, got)
		}
	}
}

func TestThemeAcceptsAllThreeLegalValues(t *testing.T) {
	s := newTestService(t)
	for _, want := range []string{"system", "light", "dark"} {
		if err := s.UpdateSettings(Settings{Theme: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().Theme; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
}

func TestThemeIsIndependentOfTheOtherSettings(t *testing.T) {
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{
		PrintOrientation: "landscape",
		SyncScrolling:    true,
		Theme:            "dark",
	}); err != nil {
		t.Fatal(err)
	}
	next := s.Settings()
	next.Theme = "light"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling {
		t.Errorf("changing the theme disturbed the other settings: %+v", got)
	}
}

func TestFigureSettingsDefaults(t *testing.T) {
	s := newTestService(t)
	got := s.Settings()
	if got.FigureAlignment != "centre" {
		t.Errorf("want centre default, got %q", got.FigureAlignment)
	}
	if got.ChartWidth != "medium" {
		t.Errorf("want medium default, got %q", got.ChartWidth)
	}
}

func TestFigureSettingsPersist(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.FigureAlignment = "left"
	next.ChartWidth = "large"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	got := NewDocumentService(recentsPath).Settings()
	if got.FigureAlignment != "left" || got.ChartWidth != "large" {
		t.Errorf("want the pair persisted across instances, got %+v", got)
	}
}

func TestFigureAlignmentNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "center", "CENTRE", "justified"} {
		if err := s.UpdateSettings(Settings{FigureAlignment: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().FigureAlignment; got != "centre" {
			t.Errorf("want %q normalised to centre, got %q", bad, got)
		}
	}
}

func TestChartWidthNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "enormous", "MEDIUM", "400"} {
		if err := s.UpdateSettings(Settings{ChartWidth: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().ChartWidth; got != "medium" {
			t.Errorf("want %q normalised to medium, got %q", bad, got)
		}
	}
}

func TestFigureSettingsAcceptEveryLegalValue(t *testing.T) {
	s := newTestService(t)
	for _, want := range []string{"left", "centre", "right"} {
		if err := s.UpdateSettings(Settings{FigureAlignment: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().FigureAlignment; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
	for _, want := range []string{"small", "medium", "large"} {
		if err := s.UpdateSettings(Settings{ChartWidth: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().ChartWidth; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
}

func TestFigureSettingsAreIndependentOfTheOthers(t *testing.T) {
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{
		PrintOrientation: "landscape",
		SyncScrolling:    true,
		Theme:            "dark",
		FigureAlignment:  "right",
		ChartWidth:       "small",
	}); err != nil {
		t.Fatal(err)
	}
	next := s.Settings()
	next.ChartWidth = "large"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling ||
		got.Theme != "dark" || got.FigureAlignment != "right" {
		t.Errorf("changing the chart width disturbed the other settings: %+v", got)
	}
}
