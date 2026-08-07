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
 * Renders builder state as Vega-Lite spec text.
 *
 * Every optional property is omitted rather than emitted empty, and `readSpec`
 * inverts each omission exactly. That symmetry is what makes the round-trip
 * property in chartSpec.test.ts hold — changing an omission here without
 * changing the matching read there will fail that test, which is the point.
 */
export function buildSpec(state: BuilderState): string {
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
