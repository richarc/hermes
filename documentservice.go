package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const maxRecents = 10

// A pasted or imported table is inlined into the document, so an enormous file
// would produce an unusable paper rather than a chart. Refuse early and say so.
const maxDataFileBytes = 10 << 20 // 10 MB

type Document struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type DocumentService struct {
	recentsPath string
	settings    *settingsStore
	drafts      *draftStore
	dirty       atomic.Bool
	window      *application.WebviewWindow
	// Notified whenever the recents list changes (add or clear), so the
	// native Open Recent menu can be rebuilt. Set once during startup.
	onRecentsChanged func()
	// Brings the window back to the front. Set once during startup; nil in
	// tests, where there is no window. See PickCitations for why it exists.
	onRefocus func()
	// Serialises the read-modify-write of the recents file.
	recentsMu      sync.Mutex
	watchTick      time.Duration
	emitBibChanged func()
	watchMu        sync.Mutex
	watchCancel    context.CancelFunc
	caywBase       string
}

func NewDocumentService(recentsPath string) *DocumentService {
	dataDir := filepath.Dir(recentsPath)
	s := &DocumentService{
		recentsPath: recentsPath,
		settings:    newSettingsStore(filepath.Join(dataDir, "settings.json")),
		drafts:      newDraftStore(filepath.Join(dataDir, "drafts")),
		watchTick:   2 * time.Second,
		caywBase:    "http://127.0.0.1:23119",
	}
	s.drafts.prune(time.Now())
	return s
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
	if err := writeFileAtomic(path, []byte(content), 0o644); err != nil {
		return err
	}
	s.addRecent(path)
	s.dirty.Store(false)
	return nil
}

// RecentFiles takes no lock: the list is written atomically, so a concurrent
// update is either fully visible or not visible at all — there is no partial
// state on disk to read. Only the read-modify-write in addRecent needs
// serialising, and it uses readRecents directly to avoid re-entering the lock.
func (s *DocumentService) RecentFiles() []string {
	return s.readRecents()
}

func (s *DocumentService) readRecents() []string {
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

// WriteDraft, DiscardDraft and RecoverDraft are the recovery-draft bindings.
// The frontend decides *when* (lib/recoveryDraft.ts: debounced while dirty,
// discarded on the dirty-to-clean transition); the store decides whether a
// draft is still worth offering. See recovery.go.
func (s *DocumentService) WriteDraft(docPath, content string) error {
	return s.drafts.write(docPath, content)
}

func (s *DocumentService) DiscardDraft(docPath string) error {
	return s.drafts.discard(docPath)
}

func (s *DocumentService) RecoverDraft(docPath string) (Draft, error) {
	return s.drafts.find(docPath)
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

// ImportData opens a native picker for a delimited data file and returns its
// contents. The reading half is split into readDataFile so it stays testable,
// the same way ReadBibliography is testable while Open is not.
func (s *DocumentService) ImportData() (string, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Import Data").
		AddFilter("Data files", "*.csv;*.tsv;*.txt").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	return readDataFile(path)
}

func readDataFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > maxDataFileBytes {
		return "", fmt.Errorf("that file is %d MB; the limit is %d MB because the data is stored in the document",
			info.Size()>>20, maxDataFileBytes>>20)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
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

// ChooseNewDocumentPath asks where a new document should live. It is the
// first half of File → New…: the frontend needs the chosen name before it can
// compose the document, because the live `bibliography:` key names a `.bib`
// after the document's own stem. Empty when the panel is cancelled.
//
// The panel's own "Replace?" prompt is what guards an existing `.md`; nothing
// here checks for one.
func (s *DocumentService) ChooseNewDocumentPath() (string, error) {
	return application.Get().Dialog.SaveFile().
		SetMessage("New Markdown Document").
		SetFilename("untitled.md").
		PromptForSingleSelection()
}

// ChooseBibliography is the open panel behind "an existing file" in the New
// Document flow. It returns "" when the author cancels, so the caller can
// tell a cancel from an error, as ChooseNewDocumentPath does.
func (s *DocumentService) ChooseBibliography() (string, error) {
	return application.Get().Dialog.OpenFile().
		SetTitle("Choose Bibliography").
		AddFilter("BibTeX files", "*.bib").
		PromptForSingleSelection()
}

// CreateDocument is the second half: it writes the document, and — when
// bibName is set — a bibliography beside it, resolved the same way a
// `bibliography:` key is. A bibliography that already exists is left exactly
// as it is: a library beside the chosen name is what the author wants to
// point at, not something to replace with a seed. Only bibContent's write is
// conditional; the document itself is always written, since the save panel
// has already confirmed any replacement.
//
// Split from the dialog so it is testable without one, the same reason
// feedbackURL and quitRequest are separate from what calls them.
func (s *DocumentService) CreateDocument(path, content, bibName, bibContent string) (Document, error) {
	if bibName != "" {
		bibPath := resolveAgainstDoc(bibName, path)
		if _, err := os.Stat(bibPath); os.IsNotExist(err) {
			if err := writeFileAtomic(bibPath, []byte(bibContent), 0o644); err != nil {
				return Document{}, fmt.Errorf("creating bibliography: %w", err)
			}
		} else if err != nil {
			return Document{}, fmt.Errorf("checking for bibliography: %w", err)
		}
	}
	if err := s.Save(path, content); err != nil {
		return Document{}, err
	}
	return Document{Path: path, Content: content}, nil
}

// Settings returns every persisted preference. Values are always valid: a
// missing or malformed file, and any field outside its allowed set, read back
// as that field's default.
func (s *DocumentService) Settings() Settings {
	return s.settings.get()
}

// UpdateSettings persists the given preferences and returns an error if they
// could not be written, so a caller can tell the user the choice did not
// stick. Out-of-range values are normalised rather than rejected.
func (s *DocumentService) UpdateSettings(next Settings) error {
	return s.settings.set(next)
}

// paperPoints returns a paper's width and height in PostScript points, which
// is the unit NSPrintInfo works in. An unknown name falls back to A4 rather
// than to a zero-sized page.
func paperPoints(size string, landscape bool) (float64, float64) {
	w, h := 595.28, 841.89 // A4
	if size == "letter" {
		w, h = 612, 792
	}
	if landscape {
		return h, w
	}
	return w, h
}

// paperPWGName is the PWG paper name matching paperPoints' dimensions. It is
// set on NSPrintInfo alongside the size, because setting the size alone leaves
// the default printer's inherited name in place and some AppKit paths
// re-derive the size from the name. Unknown names fall back to A4, in step
// with paperPoints, so the pair can never name one paper and measure another.
func paperPWGName(size string) string {
	if size == "letter" {
		return "na-letter"
	}
	return "iso-a4"
}

// pdfExportFilename is the name the save dialog offers: the document's own
// name with a .pdf extension. An unsaved document has no path, so it gets the
// same placeholder Save As uses.
func pdfExportFilename(docPath string) string {
	if docPath == "" {
		return "untitled.pdf"
	}
	base := filepath.Base(docPath)
	return strings.TrimSuffix(base, filepath.Ext(base)) + ".pdf"
}

// ExportPDF asks for a destination and renders the document there with no
// print panel. The panel is deliberately not used: paper size is a setting
// now, because the preview draws the sheet at that size, and the panel's own
// paper picker would be a second source of truth for the same fact — a user
// who changed it there would get a PDF whose measure did not match the sheet
// they wrote against.
func (s *DocumentService) ExportPDF(docPath string) error {
	if s.window == nil {
		return nil
	}
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Export PDF").
		SetFilename(pdfExportFilename(docPath)).
		PromptForSingleSelection()
	if err != nil || path == "" {
		return err
	}
	set := s.settings.get()
	landscape := set.PrintOrientation == "landscape"
	w, h := paperPoints(set.PaperSize, landscape)
	if !exportPDF(path, paperPWGName(set.PaperSize), landscape, w, h) {
		return fmt.Errorf("could not export the PDF")
	}
	return nil
}

// PrintDocument opens the system print panel. Picking a printer and a tray is
// a job the panel is genuinely good at; picking paper is not, which is why
// export no longer goes through here.
func (s *DocumentService) PrintDocument() {
	if s.window == nil {
		return
	}
	if !printWithOrientation(s.settings.get().PrintOrientation == "landscape") {
		// Fallback: Wails' built-in print (hardcodes landscape upstream).
		_ = s.window.Print()
	}
}

func (s *DocumentService) Quit() {
	application.Get().Quit()
}

func (s *DocumentService) ClearRecents() {
	s.recentsMu.Lock()
	_ = os.Remove(s.recentsPath)
	s.recentsMu.Unlock()
	s.notifyRecentsChanged()
}

// addRecent moves path to the front of the list. The read-modify-write is
// serialised because Wails runs each binding call on its own goroutine: two
// overlapping saves would otherwise both read the old list and the second
// write would discard the first one's entry.
func (s *DocumentService) addRecent(path string) {
	s.recentsMu.Lock()
	err := s.storeRecentLocked(path)
	s.recentsMu.Unlock()
	if err != nil {
		return
	}
	s.notifyRecentsChanged()
}

func (s *DocumentService) storeRecentLocked(path string) error {
	recents := slices.DeleteFunc(s.readRecents(), func(p string) bool { return p == path })
	recents = slices.Insert(recents, 0, path)
	recents = recents[:min(len(recents), maxRecents)]

	if err := os.MkdirAll(filepath.Dir(s.recentsPath), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(recents)
	if err != nil {
		return err
	}
	return writeFileAtomic(s.recentsPath, data, 0o644)
}

func (s *DocumentService) notifyRecentsChanged() {
	if s.onRecentsChanged != nil {
		s.onRecentsChanged()
	}
}

func (s *DocumentService) refocusWindow() {
	if s.onRefocus != nil {
		s.onRefocus()
	}
}

// resolveAgainstDoc resolves a path named inside a document — a bibliography
// or an image — against the document's own location. Package-level rather than
// a method because it never touched the receiver and the local-image route
// needs the same rule; one copy is the point, so the two cannot diverge.
func resolveAgainstDoc(path, docPath string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(docPath), path)
}

func (s *DocumentService) ReadBibliography(path, docPath string) (string, error) {
	data, err := os.ReadFile(resolveAgainstDoc(path, docPath))
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
	resolved := resolveAgainstDoc(path, docPath)
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
