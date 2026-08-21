package main

import (
	"net/http"
	"path/filepath"
)

// localImageRoute is the path renderer.ts rewrites a document-local image
// source to. It carries the document and the source as separate query
// parameters rather than a pre-resolved path, so the join happens here
// against resolveAgainstDoc — the same resolution ReadBibliography uses —
// instead of being reimplemented in TypeScript where the two would drift.
const localImageRoute = "/_hermes/image"

// localImages serves images that live beside the user's document.
//
// The webview loads the embedded frontend bundle, so a document-relative
// `<img src>` would otherwise resolve against that bundle and 404 — which is
// exactly what it did until this route existed. Everything that is not this
// route falls through untouched; the middleware sits in front of every asset
// request and must stay invisible to all of them.
func localImages(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != localImageRoute {
			next.ServeHTTP(w, r)
			return
		}

		query := r.URL.Query()
		path, ok := localImagePath(query.Get("src"), query.Get("doc"))
		if !ok {
			http.NotFound(w, r)
			return
		}

		// The URL does not change when the file is edited in another
		// application, so a cached response would leave the preview showing a
		// stale image with no way to refresh short of restarting.
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, path)
	})
}

// localImagePath resolves an image source against the document holding it, or
// reports false when it cannot be resolved.
//
// Split from the handler so the resolution rules are reachable by a test
// without an HTTP round trip — the same reason quitRequest is separate from
// the menu closure it serves.
//
// The rules are deliberately the bibliography's: a relative source joins the
// document's folder, an absolute one stands, and `..` is allowed, because a
// figures directory shared between papers is an ordinary layout and images
// should not be stricter than `bibliography:` is.
func localImagePath(src, doc string) (string, bool) {
	if src == "" {
		return "", false
	}
	// A relative source has nothing to resolve against until the document has
	// been saved somewhere. renderer.ts does not rewrite in that case, so this
	// is the belt to its braces.
	if !filepath.IsAbs(src) && doc == "" {
		return "", false
	}
	return resolveAgainstDoc(src, doc), true
}
