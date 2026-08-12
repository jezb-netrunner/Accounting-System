import { useCallback, useRef } from 'react'

/**
 * Reusable spreadsheet grid, specialized per sheet type through a column
 * config. Keyboard-first: arrows and Tab move, Enter commits and advances
 * (appending a row at the bottom), Ctrl/Cmd+Enter posts. A block pasted
 * from Excel/Sheets fills cells with per-cell validation; a derived
 * (read-only) column shows live per-line tax; the footer is the running
 * totals strip.
 */

export interface GridColumn<Row> {
  readonly key: string
  readonly header: string
  readonly width?: string
  readonly kind: 'text' | 'amount' | 'select' | 'derived'
  readonly options?: readonly { value: string; label: string }[]
  get(row: Row): string
  set?(row: Row, value: string): Row
  /** Return an error message to flag the cell, null when valid. */
  validate?(value: string, row: Row): string | null
}

interface Props<Row> {
  rows: Row[]
  columns: readonly GridColumn<Row>[]
  onChange(rows: Row[]): void
  emptyRow(): Row
  footer?: React.ReactNode
  readOnly?: boolean
  /** Ctrl/Cmd+Enter anywhere in the grid. */
  onPost?(): void
}

export function SheetGrid<Row>({ rows, columns, onChange, emptyRow, footer, readOnly, onPost }: Props<Row>) {
  const tableRef = useRef<HTMLTableElement>(null)

  const focusCell = useCallback((r: number, c: number) => {
    requestAnimationFrame(() => {
      tableRef.current
        ?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)
        ?.focus()
    })
  }, [])

  const editableCols = columns.map((col, i) => ({ col, i })).filter(({ col }) => col.kind !== 'derived')

  const move = (r: number, c: number, dr: number, dc: number) => {
    if (dc !== 0) {
      const order = editableCols.map(({ i }) => i)
      const pos = order.indexOf(c)
      const next = order[pos + dc]
      if (next !== undefined) focusCell(r, next)
      return
    }
    const nr = r + dr
    if (nr < 0) return
    if (nr >= rows.length) {
      if (readOnly) return
      onChange([...rows, emptyRow()])
    }
    focusCell(nr, c)
  }

  const atTextBoundary = (el: EventTarget, dir: -1 | 1): boolean => {
    if (!(el instanceof HTMLInputElement)) return true
    const pos = el.selectionStart
    if (pos === null || el.selectionStart !== el.selectionEnd) return true
    return dir === -1 ? pos === 0 : pos === el.value.length
  }

  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onPost?.()
      return
    }
    switch (e.key) {
      case 'Enter':
      case 'ArrowDown':
        e.preventDefault()
        move(r, c, 1, 0)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(r, c, -1, 0)
        break
      case 'ArrowLeft':
        if (atTextBoundary(e.target, -1)) {
          e.preventDefault()
          move(r, c, 0, -1)
        }
        break
      case 'ArrowRight':
        if (atTextBoundary(e.target, 1)) {
          e.preventDefault()
          move(r, c, 0, 1)
        }
        break
    }
  }

  const update = (r: number, col: GridColumn<Row>, value: string) => {
    if (!col.set || readOnly) return
    onChange(rows.map((row, i) => (i === r ? col.set!(row, value) : row)))
  }

  /** Fill a rectangular block from TSV clipboard data starting at (r, c). */
  const onPaste = (e: React.ClipboardEvent, startR: number, startC: number) => {
    if (readOnly) return
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return // single-cell paste: default
    e.preventDefault()
    const grid = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split('\t'))
    const targetCols = editableCols.map(({ i }) => i).filter((i) => i >= startC)
    const next = [...rows]
    grid.forEach((cells, dr) => {
      const r = startR + dr
      while (next.length <= r) next.push(emptyRow())
      cells.forEach((cell, dc) => {
        const colIndex = targetCols[dc]
        if (colIndex === undefined) return
        const col = columns[colIndex]!
        if (col.set) next[r] = col.set(next[r]!, normalizePasted(col, cell.trim()))
      })
    })
    onChange(next)
  }

  /** Map pasted text onto select options (accepts value or label, case-insensitive). */
  const normalizePasted = (col: GridColumn<Row>, cell: string): string => {
    if (col.kind !== 'select' || !col.options) return cell
    const canon = cell.toLowerCase()
    const hit = col.options.find(
      (o) => o.value.toLowerCase() === canon || o.label.toLowerCase() === canon,
    )
    return hit ? hit.value : cell
  }

  return (
    <table ref={tableRef} className="sheet-grid w-full border-collapse bg-white text-left">
      <thead>
        <tr className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <th className="w-8 border border-slate-200 px-2 py-1.5">#</th>
          {columns.map((col) => (
            <th
              key={col.key}
              style={col.width ? { width: col.width } : undefined}
              className={`border border-slate-200 px-2 py-1.5 ${col.kind === 'amount' || col.kind === 'derived' ? 'text-right' : ''}`}
            >
              {col.header}
            </th>
          ))}
          {!readOnly && <th className="w-8 border border-slate-200" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            <td className="bg-slate-50 text-center text-xs text-slate-400">{r + 1}</td>
            {columns.map((col, c) => {
              const value = col.get(row)
              const error = col.validate && value !== '' ? col.validate(value, row) : null
              const common = {
                'data-r': r,
                'data-c': c,
                onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, r, c),
                onPaste: (e: React.ClipboardEvent) => onPaste(e, r, c),
              }
              return (
                <td
                  key={col.key}
                  className={error ? 'relative !border-red-400 bg-red-50' : undefined}
                  title={error ?? undefined}
                >
                  {col.kind === 'derived' ? (
                    <div className="px-2 py-1 text-right text-sm tabular-nums text-slate-500">{value}</div>
                  ) : col.kind === 'select' ? (
                    <select
                      className="w-full bg-transparent px-1 py-1 text-sm outline-none"
                      value={value}
                      disabled={readOnly}
                      onChange={(e) => update(r, col, e.target.value)}
                      {...common}
                    >
                      {col.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={col.kind === 'amount' ? 'text-right tabular-nums' : undefined}
                      inputMode={col.kind === 'amount' ? 'decimal' : undefined}
                      value={value}
                      readOnly={readOnly}
                      onChange={(e) => update(r, col, e.target.value)}
                      {...common}
                    />
                  )}
                </td>
              )
            })}
            {!readOnly && (
              <td className="text-center">
                <button
                  tabIndex={-1}
                  className="px-1 text-slate-300 hover:text-red-500"
                  onClick={() => onChange(rows.filter((_, j) => j !== r))}
                  title="Remove line"
                >
                  ×
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  )
}
