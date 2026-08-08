package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Settings holds every persisted user preference in one value. Adding a
// preference means adding a field with a json tag, a default in
// defaultSettings, and a clamp in normalise — persistence, change
// notification, the menu rebuild, and the frontend binding all follow with no
// further wiring.
type Settings struct {
	PrintOrientation string `json:"printOrientation"`
	SyncScrolling    bool   `json:"syncScrolling"`
	Theme            string `json:"theme"`
	FigureAlignment  string `json:"figureAlignment"`
	ChartWidth       string `json:"chartWidth"`
}

func defaultSettings() Settings {
	return Settings{
		PrintOrientation: "portrait",
		SyncScrolling:    false,
		Theme:            "system",
		FigureAlignment:  "centre",
		ChartWidth:       "medium",
	}
}

// normalise replaces any value outside a field's allowed set with that field's
// default. It runs on the way in from disk *and* on the way in from a caller,
// so neither a hand-edited settings file nor a bad binding call can leave the
// app holding a preference it cannot act on.
func (s Settings) normalise() Settings {
	// SyncScrolling needs no clause: every value a bool can hold is valid.
	// Only fields with a restricted set of legal values are clamped here.
	if s.PrintOrientation != "portrait" && s.PrintOrientation != "landscape" {
		s.PrintOrientation = defaultSettings().PrintOrientation
	}
	if s.Theme != "system" && s.Theme != "light" && s.Theme != "dark" {
		s.Theme = defaultSettings().Theme
	}
	// Hermes spells this `centre` throughout; the frontend maps it to CSS's
	// `center` at the boundary, so `center` is not a legal value here.
	if s.FigureAlignment != "left" && s.FigureAlignment != "centre" && s.FigureAlignment != "right" {
		s.FigureAlignment = defaultSettings().FigureAlignment
	}
	if s.ChartWidth != "small" && s.ChartWidth != "medium" && s.ChartWidth != "large" {
		s.ChartWidth = defaultSettings().ChartWidth
	}
	return s
}

// settingsStore owns the settings file. It reads it once and then serves from
// memory, writing only when a value actually changes — the previous code
// re-read and re-parsed the file on every access, including once per menu
// rebuild.
type settingsStore struct {
	path string

	mu      sync.Mutex
	current Settings
	loaded  bool

	// Notified after a change is persisted, so the native menu can be rebuilt
	// and the frontend told. Set once during startup.
	onChanged func()
}

func newSettingsStore(path string) *settingsStore {
	return &settingsStore{path: path}
}

func (st *settingsStore) get() Settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.loadLocked()
}

// set persists next and reports whether it could be written. A value that
// normalises to what is already stored is a no-op: no write, no notification,
// so re-picking the menu item that is already selected does not rebuild the
// menu underneath the user.
func (st *settingsStore) set(next Settings) error {
	next = next.normalise()

	st.mu.Lock()
	if next == st.loadLocked() {
		st.mu.Unlock()
		return nil
	}
	// Persist before committing to memory, so a failed write leaves the store
	// reporting what is actually on disk.
	if err := st.persist(next); err != nil {
		st.mu.Unlock()
		return err
	}
	st.current = next
	st.mu.Unlock()

	if st.onChanged != nil {
		st.onChanged()
	}
	return nil
}

// loadLocked reads the file on first use. A missing, unreadable, or malformed
// file is not an error: the defaults are a complete, usable state, and losing
// a preference is not worth refusing to start over. Fields absent from the
// file normalise to their defaults, so a settings file written by an older
// version stays readable.
func (st *settingsStore) loadLocked() Settings {
	if st.loaded {
		return st.current
	}
	st.current = defaultSettings()
	st.loaded = true
	if data, err := os.ReadFile(st.path); err == nil {
		var parsed Settings
		if err := json.Unmarshal(data, &parsed); err == nil {
			st.current = parsed.normalise()
		}
	}
	return st.current
}

func (st *settingsStore) persist(s Settings) error {
	if err := os.MkdirAll(filepath.Dir(st.path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return writeFileAtomic(st.path, data, 0o644)
}
