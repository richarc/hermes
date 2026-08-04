import { parse } from '@retorquere/bibtex-parser'

export interface CSLName {
  family?: string
  given?: string
  literal?: string
}

export interface CSLEntry {
  id: string
  type: string
  title?: string
  author?: CSLName[]
  editor?: CSLName[]
  issued?: { 'date-parts': number[][] }
  'container-title'?: string
  page?: string
  volume?: string
  issue?: string
  publisher?: string
  'publisher-place'?: string
  DOI?: string
  URL?: string
}

const TYPE_MAP: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  incollection: 'chapter',
  inbook: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  techreport: 'report',
  unpublished: 'manuscript',
  online: 'webpage',
  misc: 'document',
}

interface BBTCreator {
  lastName?: string
  firstName?: string
  name?: string
  literal?: string
}

function mapNames(creators: BBTCreator[] | undefined): CSLName[] | undefined {
  if (!creators?.length) return undefined
  return creators.map((raw) => {
    const c: BBTCreator = {
      lastName: raw.lastName && restoreAngles(raw.lastName),
      firstName: raw.firstName && restoreAngles(raw.firstName),
      name: raw.name && restoreAngles(raw.name),
      literal: raw.literal && restoreAngles(raw.literal),
    }
    const literal = c.literal ?? c.name
    if (literal) return { literal }
    if (c.lastName && !c.firstName) return c.lastName.includes(' ')
      ? { literal: c.lastName }
      : { family: c.lastName }
    return { family: c.lastName, given: c.firstName }
  })
}

// The parser emulates LaTeX's OT1 text encoding, in which a bare `<` typesets
// as `¡` and `>` as `¿`. That is faithful to LaTeX but wrong for a title
// someone wrote meaning less-than, and the parser exposes no way to turn it
// off. Mapping the inverted marks back afterwards is not an option — Spanish
// titles contain them legitimately — so the brackets are swapped for private-
// use characters before parsing and swapped back after, which converts only
// what we ourselves substituted. Any of these characters already present in
// the source are dropped first, so the round trip cannot invent a bracket.
const LT = ''
const GT = ''

function protectAngles(text: string): string {
  return text.replace(/[]/g, '').replace(/</g, LT).replace(/>/g, GT)
}

function restoreAngles(text: string): string {
  return text.replaceAll(LT, '<').replaceAll(GT, '>')
}

function extractString(value: unknown): string | undefined {
  if (typeof value === 'string') return restoreAngles(value)
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return restoreAngles(value[0])
  }
  return undefined
}

export function parseBib(text: string): { entries: CSLEntry[]; warnings: string[] } {
  const parsed = parse(protectAngles(text))
  const warnings = parsed.errors.map((e: string | { error?: string }) =>
    typeof e === 'string' ? e : (e.error ?? JSON.stringify(e)),
  )
  const entries: CSLEntry[] = []
  for (const raw of parsed.entries) {
    // Skip phantom entries from parser recovery (empty key, empty fields)
    if (!raw.key) continue
    const f = raw.fields as Record<string, unknown>
    const entry: CSLEntry = {
      id: raw.key,
      type: TYPE_MAP[raw.type] ?? 'document',
      title: extractString(f.title),
      author: mapNames(f.author as BBTCreator[] | undefined),
      editor: mapNames(f.editor as BBTCreator[] | undefined),
      'container-title': extractString(f.journal ?? f.booktitle),
      page: extractString(f.pages),
      volume: extractString(f.volume),
      issue: extractString(f.number),
      publisher: extractString(f.publisher),
      'publisher-place': extractString(f.address),
      DOI: extractString(f.doi),
      URL: extractString(f.url),
    }
    const year = parseInt(extractString(f.year) ?? '', 10)
    if (!Number.isNaN(year)) entry.issued = { 'date-parts': [[year]] }
    entries.push(entry)
  }
  return { entries, warnings }
}
