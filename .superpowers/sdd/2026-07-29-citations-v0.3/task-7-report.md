# Task 7 Report: Go — CAYW picker + menu item + bindings

## Implementation Summary

Successfully implemented the Zotero CAYW picker integration for Hermes v0.3. The implementation adds a new menu item "Insert Citation…" that triggers the Better BibTeX CAYW endpoint to allow users to pick citations from their Zotero library.

### What was implemented

1. **Created `zotero.go`**: Implements the `PickCitations()` method on DocumentService
   - Makes HTTP GET request to Zotero's Better BibTeX CAYW endpoint
   - Returns Pandoc-format citation string or empty string on cancel
   - Error handling for unreachable service (5-minute timeout for user interaction)

2. **Created `zotero_test.go`**: Three comprehensive tests using httptest
   - TestPickCitationsReturnsCAYWResult: Validates correct CAYW endpoint call and response parsing
   - TestPickCitationsEmptyOnCancel: Validates empty response when user cancels
   - TestPickCitationsErrorWhenUnreachable: Validates error handling when Zotero is unavailable

3. **Modified `documentservice.go`**:
   - Added `caywBase string` field to DocumentService struct
   - Updated `NewDocumentService()` to initialize `caywBase` to `http://127.0.0.1:23119`
   - Field is injectable in tests for httptest server usage

4. **Modified `menu.go`**:
   - Added "Insert Citation…" menu item to File submenu
   - Positioned after "Open Recent" and before "Save" as specified
   - Set accelerator to `shift+cmdorctrl+c`
   - Emits `menu:insert-citation` event when clicked

5. **Generated TypeScript bindings**:
   - Ran `wails3 task common:generate:bindings`
   - Verified PickCitations, ReadBibliography, and WatchBibliography appear in `frontend/bindings/hermes/documentservice.ts`

## TDD Evidence

### RED (Initial test run before implementation)
```
./zotero_test.go:19:4: s.caywBase undefined (type *DocumentService has no field or method caywBase)
./zotero_test.go:20:16: s.PickCitations undefined (type *DocumentService has no field or method PickCitations)
[... similar errors ...]
FAIL	hermes [build failed]
```

### GREEN (Final test run after implementation)
```
=== RUN   TestPickCitationsReturnsCAYWResult
--- PASS: TestPickCitationsReturnsCAYWResult (0.00s)
=== RUN   TestPickCitationsEmptyOnCancel
--- PASS: TestPickCitationsEmptyOnCancel (0.00s)
=== RUN   TestPickCitationsErrorWhenUnreachable
--- PASS: TestPickCitationsErrorWhenUnreachable (0.00s)
=== RUN   [14 existing tests from documentservice_test.go]
--- PASS: [all]
PASS
ok  	hermes	[cached]
```

## Files Changed

### Created
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/zotero.go` (29 lines)
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/zotero_test.go` (44 lines)

### Modified
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/documentservice.go`
  - Added `caywBase string` field (line 37)
  - Updated `NewDocumentService()` to initialize `caywBase: "http://127.0.0.1:23119"` (line 48)
  
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/menu.go`
  - Added "Insert Citation…" menu item with accelerator and event emission (lines 41-43)
  
- `/Users/richarc/Development/hermes/.claude/worktrees/citations-v0.3/frontend/bindings/hermes/documentservice.ts` (regenerated)
  - PickCitations() binding added with documentation (lines 32-40)

## Verification Steps Completed

✓ TDD: Tests written first, all failed initially, all pass after implementation  
✓ `go test ./. ` — 17 tests pass (14 existing + 3 new)  
✓ `gofmt -l` — No formatting issues  
✓ `go build -o /dev/null .` — Builds successfully  
✓ `wails3 task common:generate:bindings` — Bindings regenerated  
✓ Verified PickCitations, ReadBibliography, WatchBibliography appear in frontend bindings  
✓ Menu item correctly positioned in File submenu (after Open Recent, before Save)  
✓ Commit created with specified message and co-author

## Commit

```
f2db105 feat: Zotero CAYW picker binding and Insert Citation menu item
```

## Concerns

None identified. Implementation follows the brief exactly:
- Uses injected `caywBase` field for testability (default: `http://127.0.0.1:23119`)
- Menu event name and accelerator match specification
- All tests pass
- Code is properly formatted
- TypeScript bindings correctly generated
