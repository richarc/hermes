---
toc: true
toc-depth: 3
---

# Entanglement-Verified Time Distribution

Craig Richards — a test document for the table of contents.

This page and the introduction below sit **before** the `[[toc]]` marker, so
neither heading appears in the contents. Everything after the marker does,
down to level three.

# Introduction ----

Two things to try here: click the contents entries in the preview, and
export the PDF and click them there. Also try a hand-written link straight
past the contents — [jump to the appendix](#appendix) — which works because
every heading gets an anchor, listed or not.

[[toc]]

# Methods

Prose under a level-one heading.

## Sampling

A level-two entry, nested under Methods in the contents.

### Clock preparation

Level three — the deepest listed at `toc-depth: 3`.

#### Fibre spool details

Level four: this heading is **not** in the contents, but this link to it
still works: [spool details](#fibre-spool-details).

## Analysis

Maths to give the page some height:

$$\sigma_y(\tau) = \sqrt{\frac{1}{2(N-1)}\sum_{i=1}^{N-1}(\bar{y}_{i+1}-\bar{y}_i)^2}$$

# Results

## Duplicate Heading

First of two identically named headings.

## Duplicate Heading

The second gets slug `duplicate-heading-1`, so both contents entries land on
the right one.

## Résumé & Discussion: "quotes", punctuation?

Accents survive into the slug; punctuation is dropped.

```
[[toc]] — inside a fence, so it is content, not a marker.
```

# Appendix

The target of the two hand-written links above. A `[[toc]]` paragraph
below is the *second* marker, so it renders as literal text:

[[toc]]

Back to [Methods](#methods).
