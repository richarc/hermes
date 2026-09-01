package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// Draft is what RecoverDraft hands the frontend. Found false means there is
// nothing worth offering: no draft, or one the document on disk has caught
// up with. Content is the draft's full text.
type Draft struct {
	Found   bool   `json:"found"`
	Content string `json:"content"`
}

// draftFile is the on-disk shape. The path is stored for a human reading the
// drafts folder; lookups go by key, never by this field.
type draftFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// A draft nobody has opened for this long belongs to a document that was
// renamed, deleted, or abandoned; it is removed at launch.
const draftMaxAge = 30 * 24 * time.Hour

// draftStore keeps one recovery draft per document path in dir. Explicit
// Save is still the act of record — a draft is never written over the
// document — so the only thing this has to get right is not offering a
// draft the document has since caught up with. See find.
type draftStore struct {
	dir string
}

func newDraftStore(dir string) *draftStore {
	return &draftStore{dir: dir}
}

// draftKey names the draft file for a document. An unsaved document has no
// path, so it gets a fixed key and the next launch offers it back. A saved
// document's key is a hash of its path: short, filename-safe, and free of
// the separators and spaces the path itself carries.
func draftKey(docPath string) string {
	if docPath == "" {
		return "untitled"
	}
	sum := sha256.Sum256([]byte(docPath))
	return hex.EncodeToString(sum[:8])
}

func (d *draftStore) file(docPath string) string {
	return filepath.Join(d.dir, draftKey(docPath)+".json")
}

func (d *draftStore) write(docPath, content string) error {
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(draftFile{Path: docPath, Content: content})
	if err != nil {
		return err
	}
	// 0600: the draft is the user's unsaved text, and unlike the document it
	// lives in a folder they did not choose.
	return writeFileAtomic(d.file(docPath), data, 0o600)
}

// discard removes the draft. A draft that is already gone is not an error:
// the frontend discards on every dirty-to-clean transition, and most of
// those have no draft to remove.
func (d *draftStore) discard(docPath string) error {
	err := os.Remove(d.file(docPath))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// find returns the draft for docPath if it is worth offering, and deletes
// it otherwise. Not worth offering: missing, unreadable, empty, older than
// the document (the author saved or edited the file after the draft was
// written), or identical to the document. A document that cannot be read
// does not disqualify the draft — it may be all that is left.
func (d *draftStore) find(docPath string) (Draft, error) {
	name := d.file(docPath)
	data, err := os.ReadFile(name)
	if errors.Is(err, os.ErrNotExist) {
		return Draft{}, nil
	}
	if err != nil {
		return Draft{}, err
	}
	var df draftFile
	if err := json.Unmarshal(data, &df); err != nil || df.Content == "" {
		_ = os.Remove(name)
		return Draft{}, nil
	}
	if docPath != "" && d.supersededByDocument(name, docPath, df.Content) {
		_ = os.Remove(name)
		return Draft{}, nil
	}
	return Draft{Found: true, Content: df.Content}, nil
}

// supersededByDocument reports whether the document has caught up with the
// draft: it was written at or after the draft, or already holds the same
// text. Any failure to read either file reports false, so the draft is kept.
func (d *draftStore) supersededByDocument(draftName, docPath, draftContent string) bool {
	docInfo, err := os.Stat(docPath)
	if err != nil {
		return false
	}
	draftInfo, err := os.Stat(draftName)
	if err != nil {
		return false
	}
	if !docInfo.ModTime().Before(draftInfo.ModTime()) {
		return true
	}
	doc, err := os.ReadFile(docPath)
	if err != nil {
		return false
	}
	return string(doc) == draftContent
}

// prune deletes drafts untouched for longer than draftMaxAge. Best effort:
// a missing folder or an unreadable entry is skipped, never reported.
func (d *draftStore) prune(now time.Time) {
	entries, err := os.ReadDir(d.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > draftMaxAge {
			_ = os.Remove(filepath.Join(d.dir, e.Name()))
		}
	}
}
