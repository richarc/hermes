# Task 6: Go — ReadBibliography + watcher — Report

## What Was Implemented

Added bibliography reading and mtime-polling watcher support to `DocumentService`:

### New Struct Fields
- `watchTick time.Duration` — polling interval (default: 2 seconds)
- `emitBibChanged func()` — injectable callback for emits (defaults to Wails event)
- `watchMu sync.Mutex` — protects the single watcher goroutine
- `watchCancel context.CancelFunc` — cancels the active watcher

### New Methods

**`resolveAgainstDoc(path, docPath string) string`**
- Helper that resolves relative bibliography paths against the document's directory
- Returns absolute paths unchanged

**`ReadBibliography(path, docPath string) (string, error)`**
- Reads bibliography file content (relative to document)
- Returns file contents as string or error if missing

**`WatchBibliography(path, docPath string)`**
- Re-arms the single bibliography watcher
- Empty path stops watching
- Goroutine polls mtime+size every tick
- Emits `bib:changed` event (no payload) on change
- Self-heals: missing files keep polling and notify when file appears

### Implementation Details

The watcher contract guarantees exactly one goroutine alive at a time:
- `watchMu` serializes calls (stops old watcher before starting new)
- `watchCancel` kills the active goroutine gracefully
- Initial stat of the file determines `known` state:
  - If file exists initially: subsequent ticks only emit on change
  - If file missing initially: emit immediately when it appears
- Change detection: mtime OR size difference triggers notify

---

## TDD Evidence

### Step 1: Failing Tests (RED)
Tests added to `documentservice_test.go`:
- `TestReadBibliographyResolvesRelativeToDocument` — validates relative/absolute path resolution
- `TestWatchBibliographyEmitsOnChange` — validates emission on mtime+size change
- `TestWatchBibliographySelfHealsMissingFile` — validates missing-file recovery

All three test functions verify the exact contract described in the brief.

### Step 2: Implementation (GREEN)
Added to `documentservice.go`:
- `resolveAgainstDoc()` helper (4 lines)
- `ReadBibliography()` method (6 lines)
- `WatchBibliography()` method (48 lines including goroutine)

All imports already present:
- `context` — context.WithCancel for goroutine lifecycle
- `sync` — sync.Mutex for serialization
- `time` — time.Duration and time.NewTicker for polling

### Step 3: Verification (ALL GREEN)
```
go test ./. -run 'TestReadBibliography|TestWatchBibliography'
PASS: TestReadBibliographyResolvesRelativeToDocument (0.00s)
PASS: TestWatchBibliographyEmitsOnChange (0.04s)
PASS: TestWatchBibliographySelfHealsMissingFile (0.04s)

go test ./.
All 14 tests PASS
gofmt -l documentservice.go documentservice_test.go
[no output — clean]
go build -o /dev/null .
[success]
```

---

## Files Changed

| File | Changes |
|------|---------|
| `documentservice.go` | +73 lines: 4 new struct fields, 3 methods, all imports pre-existing |
| `documentservice_test.go` | +85 lines: 3 test functions, 2 new imports (sync/atomic, time) |

---

## Self-Review

### Correctness
- Path resolution handles both relative and absolute paths correctly
- Watcher serialization (mutex + cancel) prevents goroutine leaks
- Missing-file polling correctly transitions from `known=false` to `known=true` on appearance
- Emit logic correctly detects both mtime AND size changes to handle coarse mtime resolution

### Test Coverage
- ✓ Relative path resolution
- ✓ Absolute path pass-through
- ✓ Error on missing file
- ✓ No emission before change
- ✓ Emission on mtime OR size change
- ✓ Self-healing missing-file case
- ✓ Cleanup (stop watching with empty path)

### Integration Ready
- Method signatures match the binding interface for Task 8
- Event name `bib:changed` matches spec (no payload)
- Injectable `emitBibChanged` + `watchTick` enable testing without Wails
- Goroutine is properly supervised (lifecycle tied to watcher context)

### Concerns
None — implementation follows the brief exactly, all tests pass, code is clean.

---

## Commit

```
a29081d feat: bibliography read and mtime watcher with bib:changed event
         Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

2 files changed, 158 insertions(+)
