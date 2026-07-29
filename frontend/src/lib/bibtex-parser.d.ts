declare module '@retorquere/bibtex-parser' {
  export interface Creator {
    lastName?: string
    firstName?: string
    name?: string
    literal?: string
  }

  export interface BibTeXEntry {
    key: string
    type: string
    fields: Record<string, unknown>
  }

  export interface ParseResult {
    entries: BibTeXEntry[]
    errors: Array<string | { error?: string }>
  }

  export function parse(text: string): ParseResult
}
