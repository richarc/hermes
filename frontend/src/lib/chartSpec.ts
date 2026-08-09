import type { FieldType } from './dataTable'

// Only marks that fit buildSpec's one encoding shape — an `x`, a `y` and an
// optional `color` — belong here. Adding one that does is exactly these two
// lines: the builder's dropdown renders from MARKS, readSpec validates
// against it, and buildSpec passes the name through untouched. A mark needing
// its own shape (a histogram's `bin`, a pie's `theta`, a heatmap's colour
// scale) is a different and much larger job — see the v0.7 roadmap entry.
//
// `tick` draws a short stroke at each point, which is a strip plot. `rule`
// draws a line from the baseline up to each point — a spike or stem plot, NOT
// the horizontal reference line the name suggests: that would need `y` alone
// or a `datum`, and this shape always emits both `x` and `y`.
export type Mark = 'line' | 'bar' | 'point' | 'area' | 'boxplot' | 'tick' | 'rule'
export const MARKS: readonly Mark[] = [
  'line',
  'bar',
  'point',
  'area',
  'boxplot',
  'tick',
  'rule',
]

export type Aggregate = 'none' | 'mean' | 'median' | 'sum' | 'count'
export const AGGREGATES: readonly Aggregate[] = ['none', 'mean', 'median', 'sum', 'count']

export interface Encoding {
  field: string
  type: FieldType
  /** Empty means "no explicit title", which Vega-Lite fills with the field name. */
  title: string
}

export interface ValueEncoding extends Encoding {
  aggregate: Aggregate
}

/**
 * Top-level properties the builder does not model but carries unchanged.
 *
 * Every one of these is inert with respect to what the UI edits: metadata a
 * human wrote, or sizing. Preserving them is a strictly better outcome than
 * refusing the whole chart — nothing is lost either way, but the user gets to
 * keep editing. The list is an allowlist rather than "everything unrecognised"
 * on purpose: `layer`, `transform` and `facet` are also unmodelled, and
 * carrying those alongside the `mark`/`encoding` pair buildSpec emits would
 * produce a spec that is not valid Vega-Lite at all.
 */
const PASSTHROUGH_KEYS = ['$schema', 'description', 'name', 'title', 'width', 'height'] as const

export interface BuilderState {
  mark: Mark
  rows: Record<string, string | number>[]
  x: Encoding
  y: ValueEncoding
  colour: { field: string; type: FieldType } | null
  /** Inert top-level properties preserved verbatim across a round trip. */
  extras: Record<string, unknown>
}

/**
 * The canonical form of a builder state.
 *
 * Vega-Lite's `count` counts rows and takes no field, so a field alongside it
 * cannot survive a trip through a spec. Rather than let two states collapse to
 * one spec, collapse them here — buildSpec canonicalises first, and readSpec
 * returns canonical states, so the round trip is exact by construction.
 */
export function canonicalise(state: BuilderState): BuilderState {
  if (state.y.aggregate !== 'count') return state
  return { ...state, y: { ...state.y, field: '', type: 'quantitative' } }
}

/**
 * Renders builder state as Vega-Lite spec text.
 *
 * Every optional property is omitted rather than emitted empty, and `readSpec`
 * inverts each omission exactly — but only up to canonicalisation:
 * `readSpec(buildSpec(s))` recovers `canonicalise(s)`, not necessarily `s`
 * itself. The two differ only for a `count` aggregate, where `field` cannot
 * survive the trip (see `canonicalise`); every other property is preserved
 * exactly.
 */
export function buildSpec(input: BuilderState): string {
  const state = canonicalise(input)

  const x: Record<string, unknown> = { field: state.x.field, type: state.x.type }
  if (state.x.title !== '') x.title = state.x.title

  // Vega-Lite's `count` counts rows and takes no field, so emitting one would
  // be invalid. readSpec restores the empty field for the same reason.
  const y: Record<string, unknown> =
    state.y.aggregate === 'count'
      ? { aggregate: 'count', type: 'quantitative' }
      : { field: state.y.field, type: state.y.type }
  if (state.y.aggregate !== 'none' && state.y.aggregate !== 'count') {
    y.aggregate = state.y.aggregate
  }
  if (state.y.title !== '') y.title = state.y.title

  const encoding: Record<string, unknown> = { x, y }
  if (state.colour) {
    encoding.color = { field: state.colour.field, type: state.colour.type }
  }

  // Extras lead, so `$schema` and `description` sit where a human would write
  // them. They cannot collide with what follows: PASSTHROUGH_KEYS excludes
  // data, mark and encoding.
  return JSON.stringify(
    { ...state.extras, data: { values: state.rows }, mark: state.mark, encoding },
    null,
    2,
  )
}

export type ReadResult =
  | { ok: true; state: BuilderState }
  | { ok: false; reason: 'invalid-json' }
  | { ok: false; reason: 'unsupported'; unconsumed: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

/**
 * Dotted paths where `a` and `b` differ.
 *
 * Descends into objects only when they share at least one key name — that
 * shared key name is what lets a nested mismatch (`encoding.x.title`) read
 * as more specific than its container. Two objects with no key names in
 * common at all (`{ url }` vs `{ values }`, e.g. `data` using an external
 * source rather than inline rows) are structurally different shapes, not a
 * field-by-field diff, so they are reported at their own shared path
 * (`data`) instead of as a confusing pair of one-sided leaves
 * (`data.url`, `data.values`).
 *
 * An array that differs is reported at its own path rather than per element,
 * so a data mismatch reads as `data.values` instead of thousands of
 * `data.values.0.dose` entries.
 */
function diffPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (deepEqual(a, b)) return out
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.some((k) => keysB.includes(k))) {
      for (const k of new Set([...keysA, ...keysB])) {
        diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out)
      }
      return out
    }
  }
  out.push(path === '' ? '(root)' : path)
  return out
}

/**
 * Resolves a dotted path (as produced by diffPaths, including the '(root)'
 * sentinel) against a parsed spec. Used to tell a path that genuinely exists
 * on the user's original spec from one that only exists on the rebuild side
 * — diffPaths reports both, but only the former is honest to show the user.
 */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  if (path === '(root)') return obj
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

/**
 * A row the builder can express: a plain object whose every value is a
 * string or number, matching `Record<string, string | number>` exactly.
 * Anything else — arrays, `null`, primitives, nested objects — cannot
 * survive as a column value, so `readSpec` must not cast it into one.
 */
function isValidRow(v: unknown): v is Record<string, string | number> {
  return (
    isPlainObject(v) &&
    Object.values(v).every((value) => typeof value === 'string' || typeof value === 'number')
  )
}

function readEncoding(raw: unknown): Encoding {
  const o = isPlainObject(raw) ? raw : {}
  return {
    field: typeof o.field === 'string' ? o.field : '',
    type: (o.type === 'quantitative' || o.type === 'temporal' || o.type === 'nominal'
      ? o.type
      : 'nominal') as FieldType,
    title: typeof o.title === 'string' ? o.title : '',
  }
}

/**
 * Reads spec text back into builder state, or refuses.
 *
 * Editability is decided by construction rather than by a checklist of
 * disqualifying features: derive a candidate, rebuild from it, and compare. A
 * checklist would drift out of step with buildSpec every time the UI gained a
 * control, and — more importantly — a hand-edit that the candidate failed to
 * capture is exactly what makes the rebuild differ, so this cannot silently
 * discard one.
 */
export function readSpec(json: string): ReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'unsupported', unconsumed: ['(root)'] }
  }

  const enc = isPlainObject(parsed.encoding) ? parsed.encoding : {}
  const rawY = isPlainObject(enc.y) ? enc.y : {}
  const y = readEncoding(rawY)
  const aggregate = (AGGREGATES as readonly string[]).includes(String(rawY.aggregate))
    ? (rawY.aggregate as Aggregate)
    : 'none'

  const data = isPlainObject(parsed.data) ? parsed.data : {}
  const colourEncoding = isPlainObject(enc.color) ? readEncoding(enc.color) : null
  const colour = colourEncoding ? { field: colourEncoding.field, type: colourEncoding.type } : null

  const candidate: BuilderState = {
    mark: (MARKS as readonly string[]).includes(String(parsed.mark))
      ? (parsed.mark as Mark)
      : 'line',
    rows:
      Array.isArray(data.values) && data.values.every(isValidRow)
        ? (data.values as Record<string, string | number>[])
        : [],
    x: readEncoding(enc.x),
    y: { ...y, aggregate },
    colour,
    extras: Object.fromEntries(
      PASSTHROUGH_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(parsed, k)).map((k) => [
        k,
        parsed[k],
      ]),
    ),
  }

  const rebuilt: unknown = JSON.parse(buildSpec(candidate))
  if (deepEqual(rebuilt, parsed)) return { ok: true, state: candidate }

  // diffPaths diffs both directions: it also reports paths that exist only
  // because the rebuild introduced them (a layered spec's candidate always
  // has top-level `mark`/`encoding`, even though the user's original never
  // did). Naming those to the user is actively misleading — "That chart uses
  // encoding and layer" when their spec has no top-level `encoding` at all —
  // so only paths present on the ORIGINAL spec are reportable. A path that
  // survives is present but different (e.g. encoding.x.title: null vs
  // omitted), which is still honest to show.
  const allPaths = diffPaths(parsed, rebuilt)
  const originalPaths = allPaths.filter((p) => getPath(parsed, p) !== undefined)

  return {
    ok: false,
    reason: 'unsupported',
    // If nothing survives the filter (every differing path is a rebuild-only
    // artefact), fall back to the unfiltered list rather than an empty
    // message — still generic, but not fabricated.
    unconsumed: [...new Set(originalPaths.length > 0 ? originalPaths : allPaths)].sort(),
  }
}
