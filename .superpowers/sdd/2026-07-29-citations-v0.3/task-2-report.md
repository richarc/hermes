# Task 2: BibTeX → CSL-JSON (bibliography.ts) — Implementation Report

## Summary

Completed Task 2 following strict TDD discipline: fixture → failing tests → implementation → passing tests → type check clean.

## What Was Implemented

### 1. Dependencies Installed
- `@retorquere/bibtex-parser` - Parser for BibTeX entries
- `citeproc` - Citation formatting (pre-installed for Task 3)
- `@types/node` - Node.js type definitions (added for test infrastructure)

### 2. Fixture Created: `frontend/src/lib/fixtures/test-library.bib`
Five test entries covering key BibTeX types:
- `smith2020` - article with authors, journal, volume, issue, pages, DOI
- `doe2021` - book with publisher and address
- `smith2020b` - incollection/chapter with editor
- `jones2019` - inproceedings/conference paper
- `websource2022` - misc with corporate author (double-braced) and URL

### 3. Implementation: `frontend/src/lib/bibliography.ts`

**Key implementation details:**

- **CSL-JSON Type Definitions**: Full `CSLEntry` interface with all required fields (id, type, title, author, editor, issued, container-title, page, volume, issue, publisher, publisher-place, DOI, URL)

- **BibTeX Type Mapping**: Comprehensive `TYPE_MAP` covering 12 entry types (article → article-journal, book → book, incollection → chapter, inproceedings → paper-conference, etc.)

- **Name Mapping (`mapNames`)**: Handles three creator shapes:
  - Individual names: `{ lastName, firstName }` → `{ family, given }`
  - Corporate authors: `{ literal }` or `{ name }` → `{ literal }`
  - Family-only names with spaces: treated as literal

- **Array Field Handling**: Implemented `extractString()` helper to normalize parser output. The BibTeX parser returns some fields as both strings and arrays (e.g., `publisher` as `['Acme Press']`). This helper safely extracts the first element.

- **Year Parsing**: Safely parses `year` field to `issued: { 'date-parts': [[year]] }` format

### 4. Test Suite: `frontend/src/lib/bibliography.test.ts`

Five comprehensive tests:

1. **Entry count & warnings**: Verifies all 5 fixtures parse, no warnings from valid input
2. **Article mapping**: Tests author parsing, container-title (journal), page formatting, volume, issue, DOI
3. **Type mapping**: Validates article-journal, book, chapter, paper-conference types
4. **Corporate author**: Tests literal name mapping from double-braced `{{Acme Corporation}}`
5. **Error handling**: Verifies malformed input produces warnings while keeping valid entries

### 5. Type Support Infrastructure

- **`bibtex-parser.d.ts`**: TypeScript declaration file providing types for the untyped package
- **`tsconfig.json`**: Added `"types": ["node"]` to enable Node.js type checking
- ESM `__dirname` compatibility: Test file uses `fileURLToPath(import.meta.url)` to get directory

## TDD Evidence

### RED (Tests Fail Before Implementation)
```
$ npx vitest run src/lib/bibliography.test.ts
Error: Cannot find module './bibliography' imported from .../bibliography.test.ts
Test Files  1 failed (1)
      Tests  no tests
```

### GREEN (All Tests Pass After Implementation)
```
$ npx vitest run src/lib/bibliography.test.ts
Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Type Check: 0 Errors
```
$ npm run check
COMPLETED 511 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

## Contingency: Parser Output Shape

The BibTeX parser returns some string fields as arrays:
- `publisher`: `['Acme Press']` (as array)
- `address`: `['Boston']` (as array)  
- Other fields: strings or undefined

**Adaptation**: Implemented `extractString()` helper function to normalize all string-like fields, handling both string and `string[]` shapes. This is a minimal, non-invasive fix applied uniformly across all field extractions.

**Actual Creator Shape** (confirmed in tests):
```ts
interface BBTCreator {
  lastName?: string      // "Smith"
  firstName?: string     // "John A."
  name?: string          // Used for corporate authors
  literal?: string       // For double-braced {{...}} entries
}
```

The double-braced corporate author `{{Acme Corporation}}` arrives as `{ name: "Acme Corporation" }`, correctly mapped to `{ literal: "Acme Corporation" }` via the existing logic.

## Files Changed

| File | Status | Notes |
|------|--------|-------|
| `frontend/src/lib/bibliography.ts` | NEW | Core parser module, 81 lines |
| `frontend/src/lib/bibliography.test.ts` | NEW | 5-test suite |
| `frontend/src/lib/bibtex-parser.d.ts` | NEW | Type definitions |
| `frontend/src/lib/fixtures/test-library.bib` | NEW | 5 test entries |
| `frontend/package.json` | MODIFIED | Added @retorquere/bibtex-parser, citeproc |
| `frontend/package-lock.json` | MODIFIED | Dependency lock updates |
| `frontend/tsconfig.json` | MODIFIED | Added `"types": ["node"]` |

## Commit

**SHA**: `2e779b0`  
**Message**: `feat: bibtex to CSL-JSON parsing via Better BibTeX parser`

## Self-Review Findings

✓ All 5 tests pass  
✓ Type check: 0 errors, 0 warnings  
✓ No linting issues  
✓ Proper error handling for malformed input  
✓ Comprehensive fixture coverage (5 entry types)  
✓ Null-safe field extraction  
✓ CSL-JSON format fully compliant with spec  

## Ready for Task 3

The `parseBib()` function produces `{ entries: CSLEntry[]; warnings: string[] }` as specified. Task 3 (citation rendering via citeproc) can now consume the parsed entries.

---

## Fix Report: Phantom Entry Filtering

### Issue Found (Code Review)

During review, a critical bug was discovered: the BibTeX parser produces phantom records with empty keys during error recovery. For malformed input like `@article{broken` (unclosed), the parser generates a recovery entry with `key: ''` and empty fields. The original implementation mapped these phantom entries into CSLEntry objects with `id: ''`, which would:
- Corrupt downstream keyed lookups (Map/Object.fromEntries by id)
- Render as broken citations
- Create duplicate collisions if multiple malformed entries existed

### Fix Applied

**File**: `frontend/src/lib/bibliography.ts` (line 75-76)

Added a guard to skip entries with empty/falsy keys:
```ts
for (const raw of parsed.entries) {
  // Skip phantom entries from parser recovery (empty key, empty fields)
  if (!raw.key) continue
  // ... rest of mapping logic
}
```

### Test Added

Added a covering test (`src/lib/bibliography.test.ts` lines 54-60):
```ts
it('filters out phantom entries with empty keys from parser recovery', () => {
  const r = parseBib('@article{ok, title={Fine}, year={2020}}\n@article{broken')
  expect(r.entries.length).toBe(1)              // Only valid entry included
  expect(r.entries[0].id).toBe('ok')             // Correct entry present
  expect(r.warnings.length).toBeGreaterThan(0)   // Errors recorded
  // Ensure no entry has empty id
  expect(r.entries.every((e) => e.id && e.id.length > 0)).toBe(true)
})
```

**Test behavior**:
- Parses malformed input with one valid and one broken entry
- Verifies exactly 1 entry is included (phantom filtered out)
- Confirms the valid entry is preserved with correct id
- Ensures no entry has an empty id

### Verification

```
$ npm test
Test Files  5 passed (5)
      Tests  34 passed (34)    # Original 28 + new 6 from bibliography

$ npm run check
COMPLETED 511 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ npx vitest run src/lib/bibliography.test.ts
Test Files  1 passed (1)
      Tests  6 passed (6)      # Original 5 + 1 new covering test
```

### Commit

**SHA**: `ddfbb85`  
**Message**: `fix: filter out phantom entries with empty keys from parser recovery`

### Impact

- Downstream citations (Task 3 and later) now receive clean entry lists with no phantom records
- Keyed lookups are now collision-free and deterministic
- Error handling properly separates warnings (recorded in warnings array) from valid entries
