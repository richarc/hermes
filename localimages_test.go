package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalImagePath(t *testing.T) {
	tests := []struct {
		name string
		src  string
		doc  string
		want string
		ok   bool
	}{
		{
			name: "relative source joins the document's folder",
			src:  "fig1.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/thesis/fig1.png",
			ok:   true,
		},
		{
			name: "a subfolder is joined the same way",
			src:  "figures/plot.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/thesis/figures/plot.png",
			ok:   true,
		},
		{
			// The rule chosen for images is the rule `bibliography:` already
			// uses, and that one allows escaping the document's folder — a
			// figures directory shared between papers is an ordinary layout.
			name: "a parent reference is allowed, as it is for the bibliography",
			src:  "../shared/logo.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/shared/logo.png",
			ok:   true,
		},
		{
			name: "an absolute source is used as it stands",
			src:  "/Users/me/Desktop/x.png",
			doc:  "/papers/thesis/main.md",
			want: "/Users/me/Desktop/x.png",
			ok:   true,
		},
		{
			// An unsaved document has no folder to resolve against. The
			// frontend does not rewrite in that case, so this is the belt to
			// its braces rather than a reachable path today.
			name: "a relative source with no document cannot resolve",
			src:  "fig1.png",
			doc:  "",
			ok:   false,
		},
		{
			name: "an absolute source resolves even with no document",
			src:  "/tmp/x.png",
			doc:  "",
			want: "/tmp/x.png",
			ok:   true,
		},
		{
			name: "an empty source cannot resolve",
			src:  "",
			doc:  "/papers/thesis/main.md",
			ok:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := localImagePath(tt.src, tt.doc)
			if ok != tt.ok {
				t.Fatalf("ok = %v, want %v", ok, tt.ok)
			}
			if ok && got != tt.want {
				t.Errorf("path = %q, want %q", got, tt.want)
			}
		})
	}
}

// The middleware sits in front of every asset request, so the overwhelmingly
// common case is one it must not touch.
func TestLocalImagesPassesEverythingElseThrough(t *testing.T) {
	reached := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/assets/index.js", nil)
	rec := httptest.NewRecorder()
	localImages(next).ServeHTTP(rec, req)

	if !reached {
		t.Fatal("an unrelated request did not reach the next handler")
	}
}

func TestLocalImagesServesAFileBesideTheDocument(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	if err := os.WriteFile(filepath.Join(dir, "fig1.png"), []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet,
		localImageRoute+"?doc="+doc+"&src=fig1.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "PNGDATA" {
		t.Errorf("body = %q, want the file's contents", body)
	}
	// The URL does not change when the file is edited in another application,
	// so without this the webview would keep showing a stale image with no way
	// to refresh short of restarting.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestLocalImagesReportsAMissingFile(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")

	req := httptest.NewRequest(http.MethodGet,
		localImageRoute+"?doc="+doc+"&src=absent.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestLocalImagesRefusesAnUnresolvableSource(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, localImageRoute+"?doc=&src=fig1.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// A handler that fails the test if the middleware delegates to it — used by
// the cases that must be handled by the route itself.
func refuseHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("the image route delegated to the next handler")
	})
}
