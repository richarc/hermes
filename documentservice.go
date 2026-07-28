package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
)

const maxRecents = 10

type Document struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type DocumentService struct {
	recentsPath string
	dirty       atomic.Bool
}

func NewDocumentService(recentsPath string) *DocumentService {
	return &DocumentService{recentsPath: recentsPath}
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
}
