/**
 * Bulk import from pasted TSV/CSV: parse → map columns → dry-run with
 * per-row errors → import the valid rows. Pure functions; the UI renders
 * the mapping step and the preview, the caller persists the valid rows.
 */

export interface ParsedTable {
  readonly headers: string[]
  readonly rows: string[][]
}

/** Parse pasted text. Tab-delimited wins when tabs exist (Excel clipboard); else quoted CSV. */
export function parseDelimited(text: string): ParsedTable {
  const normalized = text.replace(/\r\n?/g, '\n')
  const delimiter = normalized.includes('\t') ? '\t' : ','
  const lines = splitRecords(normalized, delimiter).filter((cells) =>
    cells.some((c) => c.trim().length > 0),
  )
  if (lines.length === 0) return { headers: [], rows: [] }
  return { headers: lines[0]!, rows: lines.slice(1) }
}

/** Record splitter honoring quoted CSV fields (quotes may contain delimiters/newlines). */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

export interface ColumnSpec {
  /** Target field key, also the mapping key. */
  readonly key: string
  readonly label: string
  readonly required: boolean
  /** Extra header aliases for auto-mapping. */
  readonly aliases?: readonly string[]
}

export interface ImportSpec<T, Ctx> {
  readonly entity: string
  readonly columns: readonly ColumnSpec[]
  /**
   * Build one entity from the mapped raw values (missing/unmapped = '').
   * Throw `new CellError(columnKey, message)` (or any Error for a row-level
   * problem) to fail the row.
   */
  build(values: Record<string, string>, ctx: Ctx, rowIndex: number): T
}

export class CellError extends Error {
  constructor(
    readonly columnKey: string,
    message: string,
  ) {
    super(message)
  }
}

export type ColumnMapping = Record<string, number | null | undefined>

/** Fuzzy-match pasted headers onto spec columns by key, label, and aliases. */
export function autoMapColumns(
  spec: ImportSpec<unknown, never> | { columns: readonly ColumnSpec[] },
  headers: readonly string[],
): ColumnMapping {
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const mapping: ColumnMapping = {}
  const taken = new Set<number>()
  for (const col of spec.columns) {
    const candidates = [col.key, col.label, ...(col.aliases ?? [])].map(canon)
    let hit = headers.findIndex((h, i) => !taken.has(i) && candidates.includes(canon(h)))
    if (hit === -1) {
      hit = headers.findIndex(
        (h, i) =>
          !taken.has(i) &&
          candidates.some((c) => c.length >= 3 && (canon(h).includes(c) || c.includes(canon(h)))),
      )
    }
    if (hit !== -1) {
      mapping[col.key] = hit
      taken.add(hit)
    }
  }
  return mapping
}

export interface RowError {
  /** 1-based data row number (header excluded). */
  readonly row: number
  readonly column: string | null
  readonly message: string
}

export interface DryRunResult<T> {
  readonly valid: T[]
  readonly errors: RowError[]
  readonly total: number
}

export function dryRunImport<T, Ctx>(
  spec: ImportSpec<T, Ctx>,
  table: ParsedTable,
  mapping: ColumnMapping,
  ctx: Ctx,
): DryRunResult<T> {
  const valid: T[] = []
  const errors: RowError[] = []
  table.rows.forEach((cells, i) => {
    const values: Record<string, string> = {}
    for (const col of spec.columns) {
      const idx = mapping[col.key]
      values[col.key] = idx === null || idx === undefined ? '' : (cells[idx] ?? '').trim()
    }
    try {
      valid.push(spec.build(values, ctx, i))
    } catch (err) {
      errors.push({
        row: i + 1,
        column: err instanceof CellError ? err.columnKey : null,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
  return { valid, errors, total: table.rows.length }
}
