package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Where the version feed lives and what it points at. A file in this
// repository rather than the Releases API: static, no rate limit, and it
// carries nothing but a version. When the documentation site ships the feed
// moves there; nothing else assumes where it is.
const (
	updateFeedURL       = "https://raw.githubusercontent.com/richarc/hermes/main/updates/latest.json"
	releasesBaseURL     = "https://github.com/richarc/hermes/releases"
	updateCheckInterval = 24 * time.Hour
	updateFetchTimeout  = 10 * time.Second
	// The feed is one short line. A body larger than this is not the feed.
	maxUpdateFeedBytes = 4 << 10
)

// UpdateResult is what CheckForUpdates hands the frontend. Checked false
// means the throttle applied and nothing was fetched; Current is filled
// either way so a manual "up to date" message can name the version.
type UpdateResult struct {
	Checked   bool   `json:"checked"`
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	URL       string `json:"url"`
}

// updateState is the throttle: when the feed was last asked, whether or not
// the answer was usable. Kept in its own file rather than in Settings so a
// daily timestamp does not rebuild the menu and notify the frontend.
type updateState struct {
	CheckedAt time.Time `json:"checkedAt"`
}

// Exactly three numeric parts, an optional leading v (tags carry one,
// config.yml does not). No pre-release or build suffixes: Hermes has never
// shipped one, and accepting them would mean defining an order for them.
var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// compareVersions reports -1, 0 or 1 as a is older than, equal to, or newer
// than b. Either side failing to parse is an error rather than a guess.
func compareVersions(a, b string) (int, error) {
	pa, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	pb, err := parseVersion(b)
	if err != nil {
		return 0, err
	}
	for i := range pa {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	return 0, nil
}

func parseVersion(v string) ([3]int, error) {
	var parts [3]int
	m := versionPattern.FindStringSubmatch(v)
	if m == nil {
		return parts, fmt.Errorf("not a version: %q", v)
	}
	for i := range parts {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return parts, err
		}
		parts[i] = n
	}
	return parts, nil
}

// parseUpdateFeed reads the version out of the feed body and validates it.
// Strict on purpose: the version is about to become part of a URL, and
// anything the pattern rejects never gets that far. Unknown keys are refused
// too — the feed has exactly one field, and a second one is a sign of a file
// that is not ours.
func parseUpdateFeed(body []byte) (string, error) {
	var feed struct {
		Version string `json:"version"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&feed); err != nil {
		return "", fmt.Errorf("the version feed could not be read: %w", err)
	}
	if dec.More() {
		return "", errors.New("the version feed carries more than one value")
	}
	if !versionPattern.MatchString(feed.Version) || strings.HasPrefix(feed.Version, "v") {
		return "", fmt.Errorf("the version feed carries an unusable version %q", feed.Version)
	}
	return feed.Version, nil
}

// releaseURL is the release page for a version that parseUpdateFeed has
// already validated. Derived, never read from the feed.
func releaseURL(version string) string {
	return releasesBaseURL + "/tag/v" + version
}

// CheckForUpdates compares the running version with the feed's. force skips
// the once-a-day throttle and the setting gate; the Help menu's manual item
// passes true, the automatic check at launch passes false.
//
// The privacy rules are all here: the request is the same bare URL every
// time with no query string and no custom header, and it happens at most
// once per interval. Nothing about the installation travels.
func (s *DocumentService) CheckForUpdates(force bool) (UpdateResult, error) {
	current := s.version()
	if current == "" {
		return UpdateResult{}, errors.New("this build has no version to compare")
	}
	result := UpdateResult{Current: current}

	now := s.now()
	if !force {
		// The frontend decides whether to ask, but the promise "nothing is
		// fetched while the setting is off" is kept here, at the layer that
		// opens the socket.
		if s.settings.get().UpdateCheck != "on" {
			return result, nil
		}
		if state, err := s.readUpdateState(); err == nil {
			since := now.Sub(state.CheckedAt)
			if since >= 0 && since < updateCheckInterval {
				return result, nil
			}
		}
	}
	// Recorded before the fetch, so a machine that cannot reach the feed is
	// not asked again on every launch that day.
	if err := s.writeUpdateState(updateState{CheckedAt: now}); err != nil {
		return result, err
	}

	latest, err := s.fetchLatestVersion()
	if err != nil {
		return result, err
	}
	cmp, err := compareVersions(current, latest)
	if err != nil {
		return result, err
	}
	result.Checked = true
	result.Latest = latest
	result.URL = releaseURL(latest)
	result.Available = cmp < 0
	return result, nil
}

func (s *DocumentService) fetchLatestVersion() (string, error) {
	client := &http.Client{
		Timeout: updateFetchTimeout,
		// The URL is a constant, so only a redirect could move the request,
		// and it must not move it to plain http.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
				return errors.New("the version feed redirected off https")
			}
			return nil
		},
	}
	resp, err := client.Get(s.updateFeed)
	if err != nil {
		return "", fmt.Errorf("the version feed could not be reached: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the version feed returned %s", resp.Status)
	}
	// One byte over the limit is read so an oversized body is detected
	// rather than silently truncated into something that might parse.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpdateFeedBytes+1))
	if err != nil {
		return "", err
	}
	if len(body) > maxUpdateFeedBytes {
		return "", errors.New("the version feed is larger than a version feed should be")
	}
	return parseUpdateFeed(body)
}

func (s *DocumentService) readUpdateState() (updateState, error) {
	var state updateState
	data, err := os.ReadFile(s.updateStatePath)
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(data, &state)
	return state, err
}

func (s *DocumentService) writeUpdateState(state updateState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	// No MkdirAll needed: xdg.DataFile("hermes/recents.json") in main.go
	// creates <data>/hermes before the service exists (adrg/xdg's
	// pathutil.Create does os.MkdirAll on the parent); the tests' temp
	// dir exists too.
	return writeFileAtomic(s.updateStatePath, data, 0o644)
}
