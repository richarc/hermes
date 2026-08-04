package main

import (
	"os"
	"path/filepath"
)

// writeFileAtomic writes data to path by way of a temp file in the same
// directory, which is fsynced and then renamed over the destination. Because
// rename is atomic, a reader either sees the previous file or the complete new
// one — never a half-written one — so an interrupted save cannot destroy the
// document being written. os.WriteFile, by contrast, truncates the destination
// before writing a byte.
//
// perm applies only when the file does not exist yet; an existing file keeps
// its own permissions, since the temp file is created 0600 and the rename
// would otherwise silently narrow them.
//
// The temp file lives beside the destination rather than in the system temp
// dir so that both are on the same filesystem — rename cannot cross one.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if info, err := os.Stat(path); err == nil {
		perm = info.Mode().Perm()
	}

	f, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	// Both are no-ops on the success path: Close has already run, and the
	// rename means there is nothing left at tmp to remove.
	defer func() {
		_ = f.Close()
		_ = os.Remove(tmp)
	}()

	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Chmod(perm); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}

	// Best effort: fsyncing the directory is what makes the rename itself
	// durable across power loss. It is not portable (opening a directory fails
	// on Windows), and the rename has already given us atomicity without it,
	// so a failure here is not worth failing the save over.
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
