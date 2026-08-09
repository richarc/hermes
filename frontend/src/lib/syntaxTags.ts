import { tagHighlighter, tags, type Highlighter, type Tag } from '@lezer/highlight'

/** A palette role and the Lezer tags that take its colour. */
export interface TokenRole {
  /** The `.tok-<name>` class the preview emits. */
  name: string
  /**
   * The `--syn-<palette>` variable that colours it, when it differs from
   * `name`. Comments are the case: they take the markdown `meta` colour
   * rather than owning one, because a comment is metadata.
   */
  palette?: string
  tags: Tag[]
}

/**
 * How code tokens are coloured, for every language at once.
 *
 * Lezer grammars all tag from one shared vocabulary, so this is per token
 * type rather than per language: `def` in Python and `func` in Go both carry
 * `tags.keyword`. Adding a language needs no entry here.
 *
 * Both panes derive from this list and nothing else, which is what stops the
 * editor and the preview drifting apart.
 *
 * Anything absent stays uncoloured. That is safe rather than broken:
 * `hermesHighlight` is a non-fallback highlighter, so CodeMirror's
 * `defaultHighlightStyle` is displaced entirely and there is nothing to fall
 * back to. Adding a role later is this list plus a palette entry.
 *
 * Comments are here too, with `palette: 'meta'` — they need a class for the
 * preview, but take the markdown `meta` colour rather than a sixth of their
 * own. Keeping them in this table is what stops the two panes disagreeing
 * about the one token type markdown also has an opinion on.
 */
export const CODE_TOKENS: TokenRole[] = [
  {
    name: 'keyword',
    tags: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.self,
      tags.null,
      tags.bool,
      tags.atom,
    ],
  },
  {
    name: 'string',
    tags: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
  },
  { name: 'number', tags: [tags.number, tags.integer, tags.float, tags.literal] },
  { name: 'type', tags: [tags.typeName, tags.className, tags.namespace] },
  {
    name: 'function',
    tags: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
  },
  {
    name: 'comment',
    palette: 'meta',
    tags: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
  },
]

/**
 * The editor's half: one HighlightStyle spec per tag, coloured through the
 * palette so a theme change needs no reconfiguration.
 */
export function codeHighlightStyleSpecs(): { tag: Tag; color: string }[] {
  return CODE_TOKENS.flatMap((role) =>
    role.tags.map((tag) => ({ tag, color: `var(--syn-${role.palette ?? role.name})` })),
  )
}

/**
 * The preview's half: the same table as classes, since a hydrated span cannot
 * carry a CodeMirror style. `style.css` maps each `.tok-<name>` to the same
 * `--syn-<name>` the editor uses.
 */
export function codeTagHighlighter(): Highlighter {
  return tagHighlighter(CODE_TOKENS.map((role) => ({ tag: role.tags, class: `tok-${role.name}` })))
}
