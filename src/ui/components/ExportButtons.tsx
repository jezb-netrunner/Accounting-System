import { downloadCsv, downloadXlsx } from './exporting'

/** CSV/XLSX export pair for any tabular report. */
export function ExportButtons({
  filename,
  sheetName,
  headers,
  rows,
}: {
  filename: string
  sheetName: string
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}) {
  return (
    <span className="flex gap-1.5">
      <button
        onClick={() => downloadCsv(`${filename}.csv`, headers, rows)}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
        title="Export as CSV"
      >
        CSV
      </button>
      <button
        onClick={() => void downloadXlsx(`${filename}.xlsx`, sheetName, headers, rows)}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
        title="Export as Excel"
      >
        XLSX
      </button>
    </span>
  )
}
