// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { reconcileChildren } from './reconcile'

function sheet(html = ''): HTMLElement {
  const el = document.createElement('div')
  if (html) reconcileChildren(el, html)
  return el
}
const kids = (el: HTMLElement) => Array.from(el.children)

describe('reconcileChildren', () => {
  it('fills an empty container with the parsed blocks and drops inter-block whitespace', () => {
    const el = sheet()
    const r = reconcileChildren(el, '<p data-source-line="1">a</p>\n<h2 data-source-line="3">b</h2>\n')
    expect(el.innerHTML).toBe('<p data-source-line="1">a</p><h2 data-source-line="3">b</h2>')
    expect(r).toEqual({ kept: 0, added: 2, removed: 0 })
  })

  it('keeps every node when the html is unchanged', () => {
    const html = '<p data-source-line="1">a</p><p data-source-line="2">b</p>'
    const el = sheet(html)
    const before = kids(el)
    const r = reconcileChildren(el, html)
    expect(kids(el)).toEqual(before)
    expect(r).toEqual({ kept: 2, added: 0, removed: 0 })
  })

  it('replaces only the block that changed', () => {
    const el = sheet('<p>a</p><p>b</p><p>c</p>')
    const [a, b, c] = kids(el)
    const r = reconcileChildren(el, '<p>a</p><p>B</p><p>c</p>')
    const after = kids(el)
    expect(after[0]).toBe(a)
    expect(after[1]).not.toBe(b)
    expect(after[1].textContent).toBe('B')
    expect(after[2]).toBe(c)
    expect(r).toEqual({ kept: 2, added: 1, removed: 1 })
  })

  it('inserts a new block between kept ones', () => {
    const el = sheet('<p>a</p><p>c</p>')
    const [a, c] = kids(el)
    reconcileChildren(el, '<p>a</p><p>b</p><p>c</p>')
    const after = kids(el)
    expect(after.map((n) => n.textContent)).toEqual(['a', 'b', 'c'])
    expect(after[0]).toBe(a)
    expect(after[2]).toBe(c)
  })

  it('removes a deleted block and keeps its neighbours', () => {
    const el = sheet('<p>a</p><p>b</p><p>c</p>')
    const [a, , c] = kids(el)
    const r = reconcileChildren(el, '<p>a</p><p>c</p>')
    expect(kids(el)).toEqual([a, c])
    expect(r).toEqual({ kept: 2, added: 0, removed: 1 })
  })

  it('keeps a block whose only change is its source line, and patches the attribute', () => {
    const el = sheet('<p data-source-line="1">a</p><pre><code data-source-line="3" class="language-js">x</code></pre>')
    const [p, pre] = kids(el)
    const r = reconcileChildren(
      el,
      '<p data-source-line="1">a</p><p data-source-line="2">new</p><pre><code data-source-line="5" class="language-js">x</code></pre>',
    )
    const after = kids(el)
    expect(after[0]).toBe(p)
    expect(after[2]).toBe(pre)
    expect(after[2].querySelector('code')!.dataset.sourceLine).toBe('5')
    expect(r).toEqual({ kept: 2, added: 1, removed: 0 })
  })

  it('keeps a node whose live content was changed by a hydrator, as long as its source is unchanged', () => {
    const el = sheet('<p>a</p><div class="vega-lite-chart" data-spec="{}"></div>')
    const chart = kids(el)[1]
    chart.appendChild(document.createElement('svg')) // what embedding does
    reconcileChildren(el, '<p>A</p><div class="vega-lite-chart" data-spec="{}"></div>')
    expect(kids(el)[1]).toBe(chart)
    expect(chart.querySelector('svg')).not.toBeNull()
  })

  it('replaces a hydrated node once its source changes', () => {
    const el = sheet('<div class="vega-lite-chart" data-spec="{}"></div>')
    const chart = kids(el)[0]
    chart.appendChild(document.createElement('svg'))
    reconcileChildren(el, '<div class="vega-lite-chart" data-spec="{&quot;a&quot;:1}"></div>')
    expect(kids(el)[0]).not.toBe(chart)
    expect(el.querySelector('svg')).toBeNull()
  })

  it('reuses kept nodes by content inside the changed region, so a moved block keeps its identity', () => {
    const el = sheet('<p>x</p><p>a</p><p>b</p><p>y</p>')
    const [, a, b] = kids(el)
    reconcileChildren(el, '<p>x</p><p>b</p><p>a</p><p>y</p>')
    const after = kids(el)
    expect(after[1]).toBe(b)
    expect(after[2]).toBe(a)
  })

  it('handles duplicate blocks on either side of an edit', () => {
    const el = sheet('<p>same</p><p>mid</p><p>same</p>')
    const [s1, , s2] = kids(el)
    reconcileChildren(el, '<p>same</p><p>MID</p><p>same</p>')
    const after = kids(el)
    expect(after[0]).toBe(s1)
    expect(after[2]).toBe(s2)
  })

  it('does not confuse a source-line value that contains markup-like text', () => {
    const el = sheet('<div class="vega-lite-chart" data-source-line="4" data-spec="{&quot;title&quot;:&quot;a > b&quot;}"></div>')
    const chart = kids(el)[0]
    reconcileChildren(el, '<div class="vega-lite-chart" data-source-line="9" data-spec="{&quot;title&quot;:&quot;a > b&quot;}"></div>')
    expect(kids(el)[0]).toBe(chart)
    expect(chart.getAttribute('data-source-line')).toBe('9')
  })

  it('empties the container for empty html', () => {
    const el = sheet('<p>a</p>')
    const r = reconcileChildren(el, '')
    expect(el.childNodes.length).toBe(0)
    expect(r).toEqual({ kept: 0, added: 0, removed: 1 })
  })
})
