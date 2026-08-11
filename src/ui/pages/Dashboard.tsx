import { useMemo, useState } from 'react'
import { addMonths, periodKey, type Period } from '../../domain/core'
import { trialBalance } from '../../domain/ledger'
import { filingCalendar } from '../../tax/filingCalendar'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

const now = new Date()
const CURRENT: Period = { year: now.getFullYear(), month: now.getMonth() + 1 }

export function Dashboard() {
  const companyId = useSelectedCompanyId()
  const { profile, entries, accounts } = useCompanyData(companyId)
  const [period, setPeriod] = useState<Period>(CURRENT)

  const obligations = useMemo(
    () => (profile.data ? filingCalendar(profile.data, period) : []),
    [profile.data, period],
  )

  const tb = useMemo(
    () =>
      entries.data && accounts.data
        ? trialBalance(entries.data, accounts.data, '9999-12-31')
        : null,
    [entries.data, accounts.data],
  )

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">Dashboard</h1>
        {profile.data && (
          <p className="text-sm text-slate-500">
            {profile.data.entityType.replace(/_/g, ' ')} · {profile.data.incomeTaxRegime.replace(/_/g, ' ')} ·{' '}
            {profile.data.businessTaxRegime.replace(/_/g, ' ')} · RDO {profile.data.rdoCode} ·{' '}
            {[...profile.data.registeredTaxTypes].length} registered tax types
          </p>
        )}
      </header>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Filing calendar — deadlines in {periodKey(period)}</h2>
          <div className="flex gap-1">
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              onClick={() => setPeriod((p) => addMonths(p, -1))}
            >
              ←
            </button>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              onClick={() => setPeriod(CURRENT)}
            >
              Today
            </button>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              onClick={() => setPeriod((p) => addMonths(p, 1))}
            >
              →
            </button>
          </div>
        </div>
        {obligations.length === 0 ? (
          <p className="py-4 text-sm text-slate-400">
            Nothing due this month under the current registration.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {obligations.map((o) => (
              <li key={`${o.formCode}-${o.periodCovered.from}`} className="flex items-center gap-4 py-2.5">
                <span className="w-24 shrink-0 rounded-md bg-brand-50 px-2 py-1 text-center text-sm font-semibold text-brand-700">
                  {o.formCode}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{o.description}</p>
                  <p className="text-xs text-slate-400">
                    {o.periodCovered.from} → {o.periodCovered.to}
                    {o.attachments.length > 0 && ` · with ${o.attachments.join(', ')}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">due {o.deadline}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-3 font-semibold">Trial balance</h2>
        {!tb || tb.rows.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">No postings yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1.5">Account</th>
                <th className="py-1.5 text-right">Debit</th>
                <th className="py-1.5 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.accountCode} className="border-t border-slate-100">
                  <td className="py-1.5">
                    {r.accountCode} — {r.accountName}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.debit.isZero() ? '' : r.debit.format()}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.credit.isZero() ? '' : r.credit.format()}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-1.5">Totals (tie by construction)</td>
                <td className="py-1.5 text-right tabular-nums">{tb.totalDebit.format()}</td>
                <td className="py-1.5 text-right tabular-nums">{tb.totalCredit.format()}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
