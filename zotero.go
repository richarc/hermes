package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// PickCitations opens Zotero's citation picker via Better BibTeX's CAYW
// endpoint and returns the chosen citations in Pandoc format. The timeout is
// long because the user is interacting with the picker; an empty response
// means they cancelled.
func (s *DocumentService) PickCitations() (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(s.caywBase + "/better-bibtex/cayw?format=pandoc")
	if err != nil {
		return "", fmt.Errorf("zotero picker unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("zotero picker returned %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	// The picker is Zotero's own window, so showing it activates Zotero — and
	// when Hermes is fullscreen it owns a Space of its own, which means macOS
	// has to switch Spaces to get there. That part is not ours to prevent; you
	// cannot use the picker without Zotero coming forward. Coming back is
	// ours, and nothing did it, so the user was left on another Space with an
	// unsaved document behind a fullscreen boundary.
	//
	// Deliberately after a response rather than on the error path above: a
	// request that never reached Zotero never showed a picker, so focus never
	// left, and grabbing it back would be a pointless steal on top of an error
	// the user still has to read. A cancel gets the same treatment as a pick —
	// it arrives here with an empty body, and the user is just as stranded.
	s.refocusWindow()
	return string(body), nil
}
