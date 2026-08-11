/**
 * A mermaid fence's optional YAML frontmatter.
 *
 * Mermaid reads a `title:` out of a leading `---` block and draws it INTO the
 * SVG, exactly as Vega-Lite draws a `title`. Hermes wants that text as a
 * figure caption instead, so it has to come out of the source before the
 * diagram is rendered — otherwise it appears twice, once in the diagram and
 * once in the figcaption. This is the same job rewriteChartSpec does for a
 * chart.
 */
export interface MermaidSource {
  /** The frontmatter `title:`, or '' when there is none. */
  title: string
  /** The diagram source with the title line removed, ready to render. */
  body: string
}

/** A leading `---` block: the delimiters, and the YAML between them. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * A top-level scalar `title:`. Deliberately anchored at column 0 — an indented
 * `title` belongs to whatever key encloses it, and Mermaid would not read it
 * as the diagram's title either.
 */
const TITLE_LINE = /^title[ \t]*:[ \t]*(.*)$/

/**
 * Splits a fence's frontmatter into its title and the source to render.
 *
 * Only a single-line scalar title is recognised. Mermaid parses full YAML;
 * this does not, and the asymmetry is deliberately safe in the direction it
 * fails: an unrecognised title stays in the body, Mermaid draws it inside the
 * SVG, and the diagram is simply not a numbered figure. A caption is never
 * wrong, only absent.
 */
export function parseMermaidSource(text: string): MermaidSource {
  const block = FRONTMATTER.exec(text)
  if (!block) return { title: '', body: text }

  const lines = block[1].split('\n')
  const index = lines.findIndex((line) => TITLE_LINE.test(line))
  if (index === -1) return { title: '', body: text }

  const title = readScalar(TITLE_LINE.exec(lines[index])![1])
  if (title === '') return { title: '', body: text }

  const rest = text.slice(block[0].length)
  const remaining = lines.filter((_, i) => i !== index)
  // Only the title line goes. A block can also carry `config:`, and removing
  // that with it would silently change how the diagram renders.
  if (remaining.every((line) => line.trim() === '')) return { title, body: rest }
  return { title, body: `---\n${remaining.join('\n')}\n---\n${rest}` }
}

/**
 * A quoted or bare scalar, or '' for anything this cannot read confidently —
 * a block scalar (`>`, `|`), a flow collection (`[`, `{`), or nothing at all.
 */
function readScalar(raw: string): string {
  const value = raw.trim()
  if (value === '') return ''
  if (/^[|>[{]/.test(value)) return ''
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(value)
  if (quoted) return (quoted[1] ?? quoted[2]).trim()
  return value
}
