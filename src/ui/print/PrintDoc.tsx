import { useEffect } from 'react'
import type { Company } from '../../data/ports'
import { formatTIN } from '../../domain/core'

/**
 * BIR-style printable document: registered name, TIN with branch code,
 * address, period covered, column headers repeated per page, and
 * "Page N of M" — paginated in JS, styled with print CSS. No PDF library:
 * the browser's print dialog produces the loose-leaf/CAS pages.
 */

export interface PrintRow {
  readonly cells: readonly string[]
  /** 'section' renders as a full-width bold row; 'total' bold with top rule. */
  readonly kind?: 'section' | 'total'
}

export interface PrintColumn {
  readonly header: string
  readonly align?: 'right'
  readonly width?: string
}

const ROWS_PER_PAGE = 30

interface Props {
  title: string
  company: Company
  periodLabel: string
  columns: readonly PrintColumn[]
  rows: readonly PrintRow[]
  onClose(): void
}

export function PrintDoc({ title, company, periodLabel, columns, rows, onClose }: Props) {
  useEffect(() => {
    document.body.classList.add('printing')
    return () => document.body.classList.remove('printing')
  }, [])

  const pages: PrintRow[][] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE) as PrintRow[])
  }
  if (pages.length === 0) pages.push([])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-700/60">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900 px-4 py-2 text-white print:hidden">
        <span className="text-sm font-medium">{title} — print preview ({pages.length} page{pages.length === 1 ? '' : 's'})</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium hover:bg-brand-500">
            Print…
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-500 px-4 py-1.5 text-sm hover:bg-slate-800">
            Close
          </button>
        </div>
      </div>
      <div className="print-area mx-auto my-6 max-w-4xl space-y-6 print:my-0 print:max-w-none print:space-y-0">
        {pages.map((pageRows, p) => (
          <div key={p} className="print-page bg-white p-10 shadow-lg print:shadow-none">
            <header className="mb-4 text-center">
              <h1 className="text-base font-bold uppercase tracking-wide">{company.registeredName}</h1>
              {company.businessStyle && <p className="text-sm">{company.businessStyle}</p>}
              <p className="text-xs">{company.registeredAddress}</p>
              <p className="text-xs">TIN {formatTIN(company.tin)}</p>
              <h2 className="mt-3 text-sm font-bold uppercase tracking-widest">{title}</h2>
              <p className="text-xs">{periodLabel}</p>
            </header>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th
                      key={i}
                      style={c.width ? { width: c.width } : undefined}
                      className={`border border-slate-400 px-1.5 py-1 text-left font-semibold ${c.align === 'right' ? 'text-right' : ''}`}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) =>
                  row.kind === 'section' ? (
                    <tr key={i}>
                      <td colSpan={columns.length} className="border border-slate-400 bg-slate-100 px-1.5 py-1 font-bold print:bg-transparent">
                        {row.cells[0]}
                      </td>
                    </tr>
                  ) : (
                    <tr key={i} className={row.kind === 'total' ? 'font-bold' : ''}>
                      {row.cells.map((cell, j) => (
                        <td
                          key={j}
                          className={`border border-slate-400 px-1.5 py-1 ${columns[j]?.align === 'right' ? 'text-right tabular-nums' : ''} ${row.kind === 'total' ? 'border-t-2' : ''}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="border border-slate-400 px-1.5 py-4 text-center text-slate-400">
                      No entries in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <footer className="mt-4 flex justify-between text-[10px] text-slate-500">
              <span>{title} · {periodLabel}</span>
              <span>Page {p + 1} of {pages.length}</span>
            </footer>
          </div>
        ))}
      </div>
    </div>
  )
}
