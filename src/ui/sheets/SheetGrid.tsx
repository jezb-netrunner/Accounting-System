import { useRef } from 'react'
import type { VatClass } from '../../tax/engine/vat'

/**
 * Spreadsheet-style line grid: keyboard-first (Tab across, Enter down,
 * new row on demand) and accepts multi-cell paste from Excel/Sheets
 * (TSV on the clipboard).
 */

export interface EditableLine {
  description: string
  accountCode: string
  amount: string // peso string as typed; validated on save
  vatClass: VatClass
  atc: string
  side: 'debit' | 'credit' | ''
}

export const emptyLine = (): EditableLine => ({
  description: '',
  accountCode: '',
  amount: '',
  vatClass: 'vatable',
  atc: '',
  side: '',
})

export interface ColumnConfig {
  showAccount: boolean
  showVatClass: boolean
  showAtc: boolean
  showSide: boolean
}

interface Props {
  lines: EditableLine[]
  onChange(lines: EditableLine[]): void
  columns: ColumnConfig
  accountOptions: readonly { code: string; name: string }[]
  atcOptions: readonly { atc: string; label: string }[]
}

type Field = keyof EditableLine

export function SheetGrid({ lines, onChange, columns, accountOptions, atcOptions }: Props) {
  const tableRef = useRef<HTMLTableElement>(null)

  const fields: Field[] = [
    'description',
    ...(columns.showAccount ? (['accountCode'] as Field[]) : []),
    ...(columns.showSide ? (['side'] as Field[]) : []),
    'amount',
    ...(columns.showVatClass ? (['vatClass'] as Field[]) : []),
    ...(columns.showAtc ? (['atc'] as Field[]) : []),
  ]

  const update = (row: number, field: Field, value: string) => {
    const next = lines.map((l, i) => (i === row ? { ...l, [field]: value } : l))
    onChange(next)
  }

  const focusCell = (row: number, field: Field) => {
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-row="${row}"][data-field="${field}"]`,
    )
    el?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent, row: number, field: Field) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (row === lines.length - 1) onChange([...lines, emptyLine()])
      // Focus after the new row renders.
      requestAnimationFrame(() => focusCell(row + 1, field))
    } else if (e.key === 'ArrowUp' && row > 0) {
      e.preventDefault()
      focusCell(row - 1, field)
    }
  }

  /** Fill cells from TSV clipboard data starting at the focused cell. */
  const onPaste = (e: React.ClipboardEvent, startRow: number, startField: Field) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return // single-cell paste: default behavior
    e.preventDefault()
    const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length > 0)
    const startCol = fields.indexOf(startField)
    const next = [...lines]
    rows.forEach((rowText, dr) => {
      const r = startRow + dr
      while (next.length <= r) next.push(emptyLine())
      const cells = rowText.split('\t')
      cells.forEach((cell, dc) => {
        const field = fields[startCol + dc]
        if (!field) return
        next[r] = { ...next[r]!, [field]: cell.trim() }
      })
    })
    onChange(next)
  }

  const cellProps = (row: number, field: Field) => ({
    'data-row': row,
    'data-field': field,
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, row, field),
    onPaste: (e: React.ClipboardEvent) => onPaste(e, row, field),
  })

  return (
    <table ref={tableRef} className="sheet-grid w-full border-collapse bg-white text-left">
      <thead>
        <tr className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <th className="w-8 border border-slate-200 px-2 py-1.5">#</th>
          <th className="border border-slate-200 px-2 py-1.5">Description</th>
          {columns.showAccount && <th className="w-56 border border-slate-200 px-2 py-1.5">Account</th>}
          {columns.showSide && <th className="w-24 border border-slate-200 px-2 py-1.5">Dr/Cr</th>}
          <th className="w-32 border border-slate-200 px-2 py-1.5 text-right">Amount</th>
          {columns.showVatClass && <th className="w-28 border border-slate-200 px-2 py-1.5">VAT class</th>}
          {columns.showAtc && <th className="w-40 border border-slate-200 px-2 py-1.5">ATC</th>}
          <th className="w-8 border border-slate-200" />
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td className="bg-slate-50 text-center text-xs text-slate-400">{i + 1}</td>
            <td>
              <input
                value={l.description}
                onChange={(e) => update(i, 'description', e.target.value)}
                {...cellProps(i, 'description')}
              />
            </td>
            {columns.showAccount && (
              <td>
                <select
                  className="w-full bg-transparent px-1 py-1 text-sm outline-none"
                  value={l.accountCode}
                  onChange={(e) => update(i, 'accountCode', e.target.value)}
                  {...cellProps(i, 'accountCode')}
                >
                  <option value="">(default)</option>
                  {accountOptions.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </td>
            )}
            {columns.showSide && (
              <td>
                <select
                  className="w-full bg-transparent px-1 py-1 text-sm outline-none"
                  value={l.side}
                  onChange={(e) => update(i, 'side', e.target.value)}
                  {...cellProps(i, 'side')}
                >
                  <option value="">—</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </td>
            )}
            <td>
              <input
                inputMode="decimal"
                className="text-right"
                value={l.amount}
                onChange={(e) => update(i, 'amount', e.target.value)}
                {...cellProps(i, 'amount')}
              />
            </td>
            {columns.showVatClass && (
              <td>
                <select
                  className="w-full bg-transparent px-1 py-1 text-sm outline-none"
                  value={l.vatClass}
                  onChange={(e) => update(i, 'vatClass', e.target.value)}
                  {...cellProps(i, 'vatClass')}
                >
                  <option value="vatable">VATable</option>
                  <option value="exempt">Exempt</option>
                  <option value="zero_rated">Zero-rated</option>
                </select>
              </td>
            )}
            {columns.showAtc && (
              <td>
                <select
                  className="w-full bg-transparent px-1 py-1 text-sm outline-none"
                  value={l.atc}
                  onChange={(e) => update(i, 'atc', e.target.value)}
                  {...cellProps(i, 'atc')}
                >
                  <option value="">No withholding</option>
                  {atcOptions.map((a) => (
                    <option key={a.atc} value={a.atc}>
                      {a.atc} — {a.label}
                    </option>
                  ))}
                </select>
              </td>
            )}
            <td className="text-center">
              <button
                tabIndex={-1}
                className="px-1 text-slate-300 hover:text-red-500"
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
                title="Remove line"
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
