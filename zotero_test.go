package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPickCitationsReturnsCAYWResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/better-bibtex/cayw" || r.URL.Query().Get("format") != "pandoc" {
			t.Errorf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte("[@smith2020; @doe2021]"))
	}))
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if got != "[@smith2020; @doe2021]" {
		t.Errorf("got %q", got)
	}
}

func TestPickCitationsEmptyOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("")) // CAYW returns empty on cancel
	}))
	defer srv.Close()
	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil || got != "" {
		t.Errorf("want empty no-error, got %q err %v", got, err)
	}
}

func TestPickCitationsErrorWhenUnreachable(t *testing.T) {
	s := newTestService(t)
	s.caywBase = "http://127.0.0.1:1" // nothing listens here
	if _, err := s.PickCitations(); err == nil {
		t.Error("want error when Zotero is unreachable")
	}
}
