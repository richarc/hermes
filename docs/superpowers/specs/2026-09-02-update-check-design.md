# Update Check — Design

Source: the "An update check that sends nothing" item under v0.10.0 in
`ROADMAP.md` (decided 2026-09-01). This document fixes what that item left
open and is what the implementation plan argues from.

## What it is

Hermes can tell the user a newer version exists without knowing who they are.
It fetches a small static file over HTTPS, compares the version in it with the
version in its own bundle, and if the file's is newer says so, with a button
that opens the release page in the browser. The user downloads by hand.
Hermes never downloads or runs anything itself, so notarization and
Gatekeeper still cover the binary.

Not in scope: in-place auto-update (v1.0.0's Sparkle item), release notes
inside the app, skipping a version, a Homebrew cask (a release-process task,
no code in Hermes).

## The feed

`updates/latest.json` in this repository, on `main`:

```json
{"version": "0.10.0"}
```

Fetched from `https://raw.githubusercontent.com/richarc/hermes/main/updates/latest.json`.

Why a file in the repo rather than the Releases API: it is static, has no
rate limit, carries nothing but the version, and exists today; the roadmap
wanted a static file and named the API only as a stopgap. When the
documentation site ships the constant moves; nothing else assumes where it
is.

The file names the latest **published** release. The release process keeps
it honest in two places: `wails3 task release` refuses to run unless the
feed's version equals `build/config.yml`'s (they are bumped in the same
commit), and the README's release steps push `main` **after** the GitHub
release is published, so the feed never announces a version that cannot be
downloaded yet.

The release page URL is **derived**, never read from the feed:
`https://github.com/richarc/hermes/releases/tag/v<version>`. The version is
validated as `MAJOR.MINOR.PATCH` digits before it goes anywhere near a URL.
That is what makes the feed safe to trust: a tampered file can change a
number, not a destination.

## Privacy rules

- The request is a plain GET of the same URL every time. No query string,
  no identifier, no installed version, no custom header. What the far end
  sees is an IP address and Go's default user agent.
- At most one fetch per 24 hours, tracked by a timestamp in
  `<xdg data>/hermes/update-check.json`, written on every attempt whether or
  not it succeeded. A manual check ignores the throttle.
- Nothing is fetched automatically while the setting is off or unanswered.
  Help → Check for Updates… is the user's own act and ignores both the
  setting and the throttle.
- Asked once, at first launch, in a dialog that says exactly what is fetched.
  Not defaulted on silently.

## Setting and menu

`UpdateCheck string` (`updateCheck`) in `Settings`: `"unasked"` (default),
`"on"`, `"off"`; anything else normalises to `"unasked"`.

Help menu, between Licences and Report an Issue…:

- **Check for Updates…** — emits `menu:check-updates`; the frontend runs a
  forced check and reports the result.
- **Check for Updates Automatically** — a checkbox, ticked when the setting
  is `"on"`. Clicking flips `"on"` ↔ `"off"` (`"unasked"` counts as off). No
  accelerator.

## Go side

`update.go`:

```go
const (
    updateFeedURL       = "https://raw.githubusercontent.com/richarc/hermes/main/updates/latest.json"
    releasesBaseURL     = "https://github.com/richarc/hermes/releases"
    updateCheckInterval = 24 * time.Hour
    maxUpdateFeedBytes  = 4 << 10
)

type UpdateResult struct {
    Checked   bool   `json:"checked"`   // false: throttled, nothing fetched
    Available bool   `json:"available"`
    Current   string `json:"current"`
    Latest    string `json:"latest"`
    URL       string `json:"url"`       // release page, derived from Latest
}

func (s *DocumentService) CheckForUpdates(force bool) (UpdateResult, error)
```

Rules, in order:

1. `current := s.version()`; empty (an unbundled binary) is an error:
   `this build has no version to compare`.
2. Unless `force`, if the setting is not `"on"`, return `{Checked: false, Current: current}` with no fetch and no state write. The frontend decides whether to ask; this is where the promise is kept.
3. Unless `force`, if the state file's `checkedAt` is less than 24 h before
   `s.now()`, return `{Checked: false, Current: current}` with no fetch.
4. Record `checkedAt = now` in the state file (before the fetch, so a
   failing network is not retried on every launch).
5. GET the feed with a 10 s timeout; anything but 200 is an error; the body
   is read through a 4 KB limit; JSON is parsed strictly into
   `struct{ Version string }`; the version must match `^\d+\.\d+\.\d+$`.
6. `Available = compareVersions(current, latest) < 0`. `URL` is derived as
   above. `Latest` is always filled when the fetch succeeds.

`compareVersions(a, b string) (int, error)` accepts an optional leading `v`
(tags carry one, `config.yml` does not), requires three numeric parts, and
compares numerically.

Testability, the `caywBase` pattern: the service carries `updateFeed`,
`updateStatePath`, `now func() time.Time` and `version func() string`,
defaulted in `NewDocumentService` and overridden in tests.

## Frontend

State: `updateCheck: 'unasked' | 'on' | 'off'` from settings; `askUpdates`
(bool, the first-launch dialog); `updateNotice: UpdateResult | null` (the
update-available dialog).

Startup, after the recovery-draft offer:

- If a recovery dialog is up, do nothing more this launch; the question
  waits for a launch with nothing more urgent on screen.
- Otherwise the first-launch template runs as before; then if the setting
  is `unasked`, open the ask dialog; else if `on`, run an automatic check.

Ask dialog (label `Check for updates`, role `dialog`):

> Hermes can fetch a small file from GitHub once a day to see whether a
> newer version exists. Nothing about you or your documents is sent. You can
> change this later in the Help menu.

Buttons: **Don't Check**, **Check Automatically** (primary). Esc counts as
Don't Check, so the question is asked once. Check Automatically saves `on`
and runs a check straight away; Don't Check saves `off`.

Update-available dialog (label `Update available`, role `dialog`):

> Hermes 0.10.0 is available. You have 0.9.0.

Buttons: **Later**, **View Release** (primary: `Browser.OpenURL(url)` from
`@wailsio/runtime`, the same route the preview's links take; then close).
Esc is Later.

Results:

- Automatic, available → the dialog. Automatic, up to date or throttled →
  nothing. Automatic, error → `console.warn` only; an offline launch must
  not nag.
- Manual, available → the dialog. Manual, up to date → toast
  `Hermes 0.9.0 is up to date.` Manual, error → toast
  `Could not check for updates: <err>`.
- Manual while the chart or table builder is open → toast
  `Finish or cancel the chart or table before checking for updates.` and
  no check, the same refusal shape as `close:confirm`.

## Bindings

One new method and one new model, so `frontend/bindings/` is regenerated:
`CheckForUpdates(force: boolean): Promise<UpdateResult>`;
`Settings.updateCheck: string`.

## Docs

README: an "Updates" paragraph under Download saying what is fetched and how
to turn it off; the release steps gain the feed bump and the push-last
ordering. CHANGELOG entry. CLAUDE.md: the new event and a bullet on where the
rules live. ROADMAP item ticked.
