---
bibliography: sample-paper.bib
csl: apa
---

# Reproducible Documents in Practice

A sample document for the Hermes citation feature. Open it in Hermes and the
preview should show formatted citations and a References section at the end.
The references are fictional; swap `csl:` in the frontmatter to
`ieee`, `vancouver`, `chicago-author-date`, or `harvard` to re-render every
citation and the bibliography in that style.

## 1. Background

Interest in plain-text manuscripts has grown steadily [@nakamura2019]. The
argument for durability is made at length by @lindqvist2018, who treats file
format as an editorial decision rather than a technical one. Surveys of
authoring tools reach a similar conclusion [@chen2015], though the sample
frames were narrow.

Two studies published the same year reach opposite conclusions about
toolchain complexity [@okafor2021a; @okafor2021b] — the preview should
disambiguate these as 2021a and 2021b.

## 2. Method

We follow the preview architecture described in @silva2022 and the rendering
approach for mathematics set out by @bauer2020. Sample size was fixed in
advance [see @nakamura2019, pp. 204-206], and the coding scheme was adapted
from earlier work [cf. @moreau2017, chap. 3].

Where a claim needs a page pointer rather than a whole work, a locator is
attached directly to the key [@lindqvist2018, p. 41]. A section locator works
the same way [@rossi2023, sec. 2].

Because the year already appears in the sentence, 2019 was the first year the
effect was reported [-@nakamura2019], with the author suppressed.

A citation group can be split by a hard line wrap without breaking, which
matters for prose wrapped at eighty columns [see @silva2022,
pp. 20-22].

The recovery rate $r$ was estimated as $r = 1 - e^{-\lambda t}$, following the
standard formulation.

## 3. Results

| Condition | Sources cited | Recovered |
| --------- | ------------- | --------- |
| Baseline  | 42            | 39        |
| Converted | 42            | 27        |

Metadata loss during conversion is consistent with the figures reported by
@rossi2023.

```vega-lite
{
  "description": "Recovered sources by condition",
  "data": {
    "values": [
      {"condition": "Baseline", "recovered": 39},
      {"condition": "Converted", "recovered": 27}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "condition", "type": "nominal", "title": "Condition"},
    "y": {"field": "recovered", "type": "quantitative", "title": "Recovered"}
  }
}
```

## 4. Discussion

Interchange recommendations are now published openly
[@opencollective2024], and the corporate author should render as a single
name rather than being split into given and family parts.

Multiple works can support one claim [@nakamura2019; @lindqvist2018;
@silva2022], and a citation carries into a heading or a quotation intact:

> Format outlives software [@okafor2021a].

## 5. Things that must NOT become citations

These are the negative cases. None of the following should turn into a
citation or appear in the References list:

- An email address: write to a.nakamura@example.org for the dataset.
- Plain brackets used as brackets: [see the appendix] and [2].
- A markdown link: [the project page](https://example.org/project).
- A citation inside a code span: `[@nakamura2019]` stays literal.
- A fenced code block:

```text
[@lindqvist2018] must not be formatted here either.
```

## 6. Deliberate error

An unresolvable key must render visibly in place, in error styling, without
blanking the rest of the preview:

This citation points at nothing [@doesnotexist2099].

A group mixing a good and a bad key is reported as an error too
[@nakamura2019; @alsomissing1999].

## 7. What to check

- Every citation in sections 1–4 is formatted; none show raw `[@key]` text or
  a `data-cite-index` attribute.
- The two 2021 Okafor works are disambiguated: the group in section 1 renders
  as `(Okafor, 2021a, 2021b)`.
- Narrative citations read `Lindqvist (2018)`; suppressed-author reads
  `(2019)` alone; four authors collapse to `(Chen et al., 2015)`.
- Locators render as `p. 41` and `pp. 204–206`, and in APA the word labels are
  spelled out and capitalised: `Chapter 3`, `Section 2`. Other styles
  abbreviate them differently — that is the style's choice, not a bug.
- Nothing in section 5 is a citation, and none of those works appear in
  References unless they are also cited elsewhere.
- Section 6 shows two red error markers, `[@doesnotexist2099?]` and the mixed
  group, and the rest of the document still renders.
- References lists ten entries in alphabetical order by author, covering a
  journal article, a book, a chapter, a conference paper, a thesis, a report,
  and a web source.
- Editing `sample-paper.bib` in another editor and saving it refreshes the
  preview automatically (the bibliography watcher).
- ⌘E exports to PDF with the References section intact and no entry split
  across a page break.

There is deliberately no `## References` heading in this file: Hermes appends
the heading and the bibliography itself, so writing one here would produce two.
