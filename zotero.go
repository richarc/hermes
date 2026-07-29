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
	return string(body), nil
}
