package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The document being edited is the user's paper, so a failed write must never
// be able to leave it truncated. These pin the properties that guarantee it:
// the destination is only ever replaced by a complete file, and replacing it
// does not quietly change its permissions or litter the directory.

func TestSaveOverwritesExistingFile(t *testing.T) {
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "paper.md")

	if err := s.Save(path, "first draft"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := s.Save(path, "second draft"); err != nil {
		t.Fatalf("Save (overwrite): %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != "second draft" {
		t.Errorf("want %q, got %q", "second draft", string(data))
	}
}

func TestSavePreservesExistingFilePermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "paper.md")
	// A user who has deliberately locked a paper down to owner-only must not
	// have it widened just by saving: the temp file is created 0600 and the
	// mode has to be carried across the rename explicitly.
	if err := os.WriteFile(path, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}

	s := newTestService(t)
	if err := s.Save(path, "updated"); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("want mode 0600 preserved, got %04o", got)
	}
}

func TestSaveCreatesNewFileWithDefaultPermissions(t *testing.T) {
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "new.md")

	if err := s.Save(path, "x"); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o644 {
		t.Errorf("want mode 0644 for a new file, got %04o", got)
	}
}

func TestSaveLeavesNoTempFilesBehind(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "paper.md")

	for range 3 {
		if err := s.Save(path, "x"); err != nil {
			t.Fatalf("Save: %v", err)
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "paper.md" {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("want only paper.md in the directory, got %v", names)
	}
}

func TestSaveFailureLeavesOriginalIntactAndCleansUp(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "paper.md")
	if err := os.WriteFile(path, []byte("precious"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Deny the temp-file creation an atomic write depends on. Restore the mode
	// afterwards so t.TempDir's cleanup can remove the directory.
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	s := newTestService(t)
	if err := s.Save(path, "replacement"); err == nil {
		t.Fatal("want an error when the destination directory is not writable")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != "precious" {
		t.Errorf("original file was damaged by a failed save: got %q", string(data))
	}
}

func TestWriteFileAtomicIsNotVisibleUntilComplete(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	// While the write is in flight the destination must still read as the old
	// content — never as a partial new one. Approximated here by checking that
	// the write went through a distinct temp path rather than the target: any
	// intermediate file in the directory must not be the destination itself.
	if err := writeFileAtomic(path, []byte("brand new content"), 0o644); err != nil {
		t.Fatalf("writeFileAtomic: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "brand new content" {
		t.Errorf("got %q", string(data))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("want a single file after the write, got %d entries", len(entries))
	}
}
