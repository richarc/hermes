import type { FieldType } from './dataTable'

export type Mark = 'line' | 'bar' | 'point' | 'area' | 'boxplot'
export const MARKS: readonly Mark[] = ['line', 'bar', 'point', 'area', 'boxplot']

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

export interface BuilderState {
  mark: Mark
  rows: Record<string, string | number>[]
  x: Encoding
  y: ValueEncoding
  colour: { field: string; type: FieldType } | null
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

  return JSON.stringify({ data: { values: state.rows }, mark: state.mark, encoding }, null, 2)
}
