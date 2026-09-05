/**
 * Replaces a container's children with the blocks in `html`, keeping every
 * existing node whose block is unchanged.
 *
 * The preview used to be `sheet.innerHTML = html` on every keystroke pause,
 * which threw away every KaTeX span, live chart, diagram, highlighted code
 * block and loaded image in the document however small the edit. Here the
 * new HTML is parsed into a template, each top-level block is keyed by its
 * markup, and the sheet's children are matched against those keys: a common
 * prefix and suffix are kept as they are, and inside the changed region a
 * node is reused when a block with the same key is still there — which is
 * what keeps a moved paragraph or a chart on the far side of a duplicate
 * from being rebuilt.
 *
 * A node's key is recorded when it is inserted and never recomputed from the
 * live DOM, so a hydrator can rewrite a node's contents (embed a chart, swap
 * in an SVG, replace text with spans) and the node still matches its source
 * on the next pass. That is the contract with the hydrators: a node they
 * have already finished stays in the document as long as its markup does,
 * so each of them skips nodes it marked `data-hydrated`.
 *
 * `data-source-line` is excluded from the key by value and patched on kept
 * nodes instead. Typing a line above the whole document shifts every anchor
 * below it; without this every block would count as changed and the
 * reconciliation would degrade to a full replacement on the commonest edit.
 * The attribute sits on the block itself for most tokens and on the nested
 * `<code>` for fences, so both the key and the patch walk every carrier.
 */
export interface ReconcileResult {
  kept: number
  added: number
  removed: number
}

/** The markup each node was created from, normalised. Never read from the live DOM. */
const sourceKeys = new WeakMap<Element, string>()

// Attribute values in a serialised element are double-quoted with `"`
// escaped, so `[^"]*` cannot run past the closing quote — including into a
// data-spec that contains a literal `>`.
const SOURCE_LINE_VALUE = / data-source-line="[^"]*"/g

function keyOf(el: Element): string {
  return el.outerHTML.replace(SOURCE_LINE_VALUE, ' data-source-line=""')
}

/** Every element in a block that carries a source line, in document order. */
function anchorsOf(el: Element): Element[] {
  const inner = el.querySelectorAll('[data-source-line]')
  return el.hasAttribute('data-source-line') ? [el, ...inner] : [...inner]
}

/**
 * Copies the source lines from a freshly parsed block onto the kept node
 * standing in for it. Same key means the same markup apart from those
 * values, so the two carrier lists are the same length.
 */
function patchSourceLines(kept: Element, fresh: Element): void {
  const to = anchorsOf(kept)
  const from = anchorsOf(fresh)
  for (let i = 0; i < to.length && i < from.length; i++) {
    const value = from[i].getAttribute('data-source-line')!
    if (to[i].getAttribute('data-source-line') !== value) {
      to[i].setAttribute('data-source-line', value)
    }
  }
}

export function reconcileChildren(container: HTMLElement, html: string): ReconcileResult {
  const template = document.createElement('template')
  template.innerHTML = html
  // markdown-it separates blocks with newlines; as text nodes between block
  // elements they render as nothing, and dropping them here means the
  // container only ever holds elements, which is what makes `children` the
  // right list to diff.
  const fresh = Array.from(template.content.children)
  const freshKeys = fresh.map(keyOf)

  const old = Array.from(container.children)
  const oldKeys = old.map((el) => sourceKeys.get(el) ?? keyOf(el))

  let kept = 0
  let added = 0

  // Common prefix.
  let start = 0
  while (start < old.length && start < fresh.length && oldKeys[start] === freshKeys[start]) {
    patchSourceLines(old[start], fresh[start])
    start++
  }
  // Common suffix, not overlapping the prefix.
  let oldEnd = old.length
  let freshEnd = fresh.length
  while (oldEnd > start && freshEnd > start && oldKeys[oldEnd - 1] === freshKeys[freshEnd - 1]) {
    oldEnd--
    freshEnd--
    patchSourceLines(old[oldEnd], fresh[freshEnd])
  }
  kept += start + (old.length - oldEnd)

  // The changed region: old[start, oldEnd) becomes fresh[start, freshEnd).
  // Reuse an old node when its key is still wanted, in order, so duplicates
  // pair up first-to-first.
  const pool = new Map<string, Element[]>()
  for (let i = start; i < oldEnd; i++) {
    const list = pool.get(oldKeys[i])
    if (list) list.push(old[i])
    else pool.set(oldKeys[i], [old[i]])
  }
  const reused = new Set<Element>()
  const target: Element[] = []
  for (let i = start; i < freshEnd; i++) {
    const candidate = pool.get(freshKeys[i])?.shift()
    if (candidate) {
      patchSourceLines(candidate, fresh[i])
      reused.add(candidate)
      target.push(candidate)
      kept++
    } else {
      sourceKeys.set(fresh[i], freshKeys[i])
      target.push(fresh[i])
      added++
    }
  }

  let removed = 0
  for (let i = start; i < oldEnd; i++) {
    if (!reused.has(old[i])) {
      old[i].remove()
      removed++
    }
  }
  // Inserting before the first suffix node (or at the end) in order places
  // new nodes and moves reused ones in one pass.
  const reference = oldEnd < old.length ? old[oldEnd] : null
  for (const node of target) container.insertBefore(node, reference)

  return { kept, added, removed }
}
