package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const maxRecents = 10

type Document struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type DocumentService struct {
	recentsPath  string
	settingsPath string
	dirty        atomic.Bool
	window       *application.WebviewWindow
	// Notified whenever the recents list changes (add or clear), so the
	// native Open Recent menu can be rebuilt. Set once during startup.
	onRecentsChanged func()
	// Notified when the PDF orientation setting changes (menu rebuild).
	onOrientationChanged func()
	watchTick            time.Duration
	emitBibChanged       func()
	watchMu              sync.Mutex
	watchCancel          context.CancelFunc
	caywBase             string
}

type settings struct {
	PrintOrientation string `json:"printOrientation"`
}

func NewDocumentService(recentsPath string) *DocumentService {
	return &DocumentService{
		recentsPath:  recentsPath,
		settingsPath: filepath.Join(filepath.Dir(recentsPath), "settings.json"),
		watchTick:    2 * time.Second,
		caywBase:     "http://127.0.0.1:23119",
	}
}

func (s *DocumentService) OpenPath(path string) (Document, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Document{}, err
	}
	s.addRecent(path)
	return Document{Path: path, Content: string(data)}, nil
}

func (s *DocumentService) Save(path, content string) error {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return err
	}
	s.addRecent(path)
	s.dirty.Store(false)
	return nil
}

func (s *DocumentService) RecentFiles() []string {
	data, err := os.ReadFile(s.recentsPath)
	if err != nil {
		return []string{}
	}
	var recents []string
	if err := json.Unmarshal(data, &recents); err != nil {
		return []string{}
	}
	return recents
}

func (s *DocumentService) SetDirty(dirty bool) {
	s.dirty.Store(dirty)
}

func (s *DocumentService) IsDirty() bool {
	return s.dirty.Load()
}

func (s *DocumentService) Open() (Document, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Open Markdown File").
		AddFilter("Markdown files", "*.md;*.markdown").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return Document{}, err
	}
	return s.OpenPath(path)
}

func (s *DocumentService) SaveAs(content string) (string, error) {
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save Markdown File").
		SetFilename("untitled.md").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	if err := s.Save(path, content); err != nil {
		return "", err
	}
	return path, nil
}

// PrintOrientation returns "portrait" or "landscape"; portrait is the default.
func (s *DocumentService) PrintOrientation() string {
	data, err := os.ReadFile(s.settingsPath)
	if err != nil {
		return "portrait"
	}
	var cfg settings
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "portrait"
	}
	if cfg.PrintOrientation == "landscape" {
		return "landscape"
	}
	return "portrait"
}

func (s *DocumentService) SetPrintOrientation(orientation string) {
	if orientation != "portrait" && orientation != "landscape" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.settingsPath), 0o755); err != nil {
		return
	}
	data, err := json.Marshal(settings{PrintOrientation: orientation})
	if err != nil {
		return
	}
	if err := os.WriteFile(s.settingsPath, data, 0o644); err != nil {
		return
	}
	if s.onOrientationChanged != nil {
		s.onOrientationChanged()
	}
}

func (s *DocumentService) ExportPDF() {
	if s.window == nil {
		return
	}
	if !printWithOrientation(s.PrintOrientation() == "landscape") {
		// Fallback: Wails' built-in print (hardcodes landscape upstream).
		_ = s.window.Print()
	}
}

func (s *DocumentService) Quit() {
	application.Get().Quit()
}

func (s *DocumentService) ClearRecents() {
	_ = os.Remove(s.recentsPath)
	s.notifyRecentsChanged()
}

func (s *DocumentService) addRecent(path string) {
	recents := s.RecentFiles()
	recents = slices.DeleteFunc(recents, func(p string) bool { return p == path })
	recents = append([]string{path}, recents...)
	if len(recents) > maxRecents {
		recents = recents[:maxRecents]
	}
	if err := os.MkdirAll(filepath.Dir(s.recentsPath), 0o755); err != nil {
		return
	}
	data, err := json.Marshal(recents)
	if err != nil {
		return
	}
	_ = os.WriteFile(s.recentsPath, data, 0o644)
	s.notifyRecentsChanged()
}

func (s *DocumentService) notifyRecentsChanged() {
	if s.onRecentsChanged != nil {
		s.onRecentsChanged()
	}
}

func (s *DocumentService) resolveAgainstDoc(path, docPath string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(docPath), path)
}

func (s *DocumentService) ReadBibliography(path, docPath string) (string, error) {
	data, err := os.ReadFile(s.resolveAgainstDoc(path, docPath))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WatchBibliography (re)arms the single bibliography watcher. An empty path
// stops watching. The goroutine polls mtime+size and notifies on change; a
// missing file keeps polling and notifies when it appears.
func (s *DocumentService) WatchBibliography(path, docPath string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if s.watchCancel != nil {
		s.watchCancel()
		s.watchCancel = nil
	}
	if path == "" {
		return
	}
	resolved := s.resolveAgainstDoc(path, docPath)
	ctx, cancel := context.WithCancel(context.Background())
	s.watchCancel = cancel

	notify := s.emitBibChanged
	if notify == nil {
		notify = func() { application.Get().Event.Emit("bib:changed") }
	}

	go func() {
		var lastMod time.Time
		var lastSize int64
		known := false
		if info, err := os.Stat(resolved); err == nil {
			lastMod, lastSize, known = info.ModTime(), info.Size(), true
		}
		ticker := time.NewTicker(s.watchTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				info, err := os.Stat(resolved)
				if err != nil {
					known = false
					continue
				}
				if !known || !info.ModTime().Equal(lastMod) || info.Size() != lastSize {
					lastMod, lastSize, known = info.ModTime(), info.Size(), true
					notify()
				}
			}
		}
	}()
}
