import { useMemo, useState } from 'react'
import {
  autoMapColumns,
  dryRunImport,
  parseDelimited,
  type ColumnMapping,
  type ImportSpec,
} from '../../domain/importer'
import type { ImportCtx } from '../../domain/importSpecs'

/**
 * Bulk import: paste TSV/CSV → map columns → dry-run preview with per-row
 * errors → import the valid rows. Generic over the entity's ImportSpec.
 */

interface Props<T> {
  spec: ImportSpec<T, ImportCtx>
  companyId: string
  onImport(rows: T[]): Promise<void>
  onClose(): void
}

export function ImportDialog<T>({ spec, companyId, onImport, onClose }: Props<T>) {
  const [text, setText] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const table = useMemo(() => (text.trim() ? parseDelimited(text) : null), [text])
  const effectiveMapping = useMemo(
    () => mapping ?? (table ? autoMapColumns(spec, table.headers) : null),
    [mapping, table, spec],
  )
  const dryRun = useMemo(
    () =>
      table && effectiveMapping
        ? dryRunImport(spec, table, effectiveMapping, { companyId })
        : null,
    [table, effectiveMapping, spec, companyId],
  )

  const doImport = async () => {
    if (!dryRun || dryRun.valid.length === 0) return
    setBusy(true)
    try {
      await onImport(dryRun.valid)
      setDone(`${dryRun.valid.length} row(s) imported${dryRun.errors.length ? `; ${dryRun.errors.length} skipped` : ''}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
      <div className="w-full max-w-3xl space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Import {spec.entity.toLowerCase()}</h2>
            <p className="text-sm text-slate-500">
              Paste rows from Excel/Sheets (TSV) or a CSV file — first row must be headers.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">{done}</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              className="input h-32 font-mono text-xs"
              placeholder={`name\ttin\trole\nAcme Corp\t123-456-789-000\tcustomer`}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setMapping(null) // re-auto-map for the new headers
              }}
            />

            {table && table.headers.length > 0 && effectiveMapping && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-600">Column mapping</h3>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {spec.columns.map((col) => (
                    <label key={col.key} className="block text-xs">
                      <span className="mb-0.5 block text-slate-500">
                        {col.label}
                        {col.required && <span className="text-red-500"> *</span>}
                      </span>
                      <select
                        className="input py-1.5"
                        value={effectiveMapping[col.key] ?? ''}
                        onChange={(e) =>
                          setMapping({
                            ...effectiveMapping,
                            [col.key]: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">— not mapped —</option>
                        {table.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `(column ${i + 1})`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {dryRun && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-600">
                  Dry run: {dryRun.valid.length} of {dryRun.total} row(s) importable
                </h3>
                {dryRun.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50">
                    <table className="w-full text-left text-xs">
                      <thead className="text-red-500">
                        <tr>
                          <th className="px-2 py-1">Row</th>
                          <th className="px-2 py-1">Column</th>
                          <th className="px-2 py-1">Problem</th>
                        </tr>
                      </thead>
                      <tbody className="text-red-700">
                        {dryRun.errors.map((e, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="px-2 py-1">{e.row}</td>
                            <td className="px-2 py-1">{e.column ?? '—'}</td>
                            <td className="px-2 py-1">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button
                disabled={!dryRun || dryRun.valid.length === 0 || busy}
                onClick={() => void doImport()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Importing…' : `Import ${dryRun?.valid.length ?? 0} row(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
