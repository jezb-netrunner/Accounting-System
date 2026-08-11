import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import type { Period } from '../../domain/core'
import { lockPeriod, validatePeriodClose } from '../../domain/periodClose'
import { useCompanyData, useInvalidateCompany, useSelectedCompanyId } from '../state/company'

const now = new Date()

export function ClosePage() {
  const companyId = useSelectedCompanyId()
  const { sheets, entries, locks } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()
  const [period, setPeriod] = useState<Period>({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [message, setMessage] = useState<string | null>(null)

  const checks = useMemo(
    () =>
      sheets.data && entries.data && locks.data
        ? validatePeriodClose({ period, sheets: sheets.data, entries: entries.data, locks: locks.data })
        : [],
    [period, sheets.data, entries.data, locks.data],
  )
  const allPass = checks.length > 0 && checks.every((c) => c.passed)

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  const doLock = async () => {
    try {
      const lock = lockPeriod({
        companyId,
        period,
        sheets: sheets.data ?? [],
        entries: entries.data ?? [],
        locks: locks.data ?? [],
        lockedBy: 'local-user',
        now: new Date().toISOString(),
      })
      await dataPort().periodLocks.append(lock)
      invalidate(companyId)
      setMessage(`Period ${lock.periodKey} locked. Posting into it is now blocked.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-bold">Period close</h1>
        <p className="text-sm text-slate-500">
          Review, pass every check, then lock. A locked period rejects all further posting;
          corrections happen in open periods via reversing entries.
        </p>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <label>Period</label>
        <input
          type="month"
          value={`${period.year}-${String(period.month).padStart(2, '0')}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-')
            if (y && m) setPeriod({ year: Number(y), month: Number(m) })
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        />
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <ul className="divide-y divide-slate-100">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2.5">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  c.passed ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'
                }`}
              >
                {c.passed ? '✓' : '✗'}
              </span>
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-slate-500">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <button
          disabled={!allPass}
          onClick={() => void doLock()}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Lock period
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Locked periods</h2>
        <div className="flex flex-wrap gap-2">
          {(locks.data ?? []).length === 0 && <p className="text-sm text-slate-400">None yet.</p>}
          {(locks.data ?? []).map((l) => (
            <span key={l.periodKey} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium">
              {l.periodKey} 🔒
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
