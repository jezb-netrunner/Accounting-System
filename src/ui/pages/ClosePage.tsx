import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import { auditEvent } from '../../domain/audit'
import { periodEnd, periodStart, type Period } from '../../domain/core'
import { atcCodeToRule } from '../../domain/masterData'
import {
  blockersPass,
  lockPeriod,
  validatePeriodClose,
  type CloseValidationInput,
} from '../../domain/periodClose'
import {
  collectWithholdingTxns,
  saleDocuments,
  type ReturnContext,
} from '../../reports/returns/context'
import { withholdingForRange } from '../../tax/engine/withholdingPeriod'
import { useCompanyData, useInvalidateCompany, useSelectedCompanyId } from '../state/company'

/**
 * Period close: real validations (drafts, prior periods, trial balance tie,
 * subledger-vs-control, VAT and withholding reconciliation against source
 * documents, required returns generated). Blockers prevent the lock;
 * warnings don't. Locking blocks posting into the period; unlocking is an
 * explicit action that writes to the audit trail.
 */

const now = new Date()

export function ClosePage() {
  const companyId = useSelectedCompanyId()
  const { sheets, entries, locks, accounts, profile, parties } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()
  const [period, setPeriod] = useState<Period>({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [message, setMessage] = useState<string | null>(null)

  const companyQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => dataPort().companies.get(companyId!),
    enabled: !!companyId,
  })
  const generatedQ = useQuery({
    queryKey: ['generatedReturns', companyId],
    queryFn: () => dataPort().generatedReturns.list(companyId!),
    enabled: !!companyId,
  })
  const atcCodesQ = useQuery({
    queryKey: ['atcCodes', companyId],
    queryFn: () => dataPort().atcCodes.list(companyId!),
    enabled: !!companyId,
  })
  const employeesQ = useQuery({
    queryKey: ['employees', companyId],
    queryFn: () => dataPort().employees.list(companyId!),
    enabled: !!companyId,
  })

  // Document-derived recon figures for the period.
  const derived = useMemo(() => {
    if (!companyQ.data || !profile.data) return {}
    const ctx: ReturnContext = {
      company: companyQ.data,
      profile: profile.data,
      entries: entries.data ?? [],
      sheets: sheets.data ?? [],
      parties: parties.data ?? [],
      employees: employeesQ.data ?? [],
      accounts: accounts.data ?? [],
      customAtcRates: (atcCodesQ.data ?? []).filter((a) => a.active).map(atcCodeToRule),
      priorReturns: generatedQ.data ?? [],
    }
    const from = periodStart(period)
    const to = periodEnd(period)
    const outputVat = saleDocuments(ctx, from, to).reduce(
      (a, d) => a + d.sign * d.totals.vat.centavos,
      0,
    )
    const wht = withholdingForRange(collectWithholdingTxns(ctx), from, to, 'expanded')
    return { derivedOutputVatCentavos: outputVat, derivedWithholdingCentavos: wht.centavos }
  }, [companyQ.data, profile.data, entries.data, sheets.data, parties.data, employeesQ.data, accounts.data, atcCodesQ.data, generatedQ.data, period])

  const validationInput = useMemo(
    (): CloseValidationInput => ({
      period,
      profile: profile.data ?? null,
      sheets: sheets.data ?? [],
      entries: entries.data ?? [],
      accounts: accounts.data ?? [],
      locks: locks.data ?? [],
      generatedReturns: generatedQ.data ?? [],
      ...derived,
    }),
    [period, profile.data, sheets.data, entries.data, accounts.data, locks.data, generatedQ.data, derived],
  )

  const checks = useMemo(() => validatePeriodClose(validationInput), [validationInput])
  const canLock = blockersPass(checks) && checks.length > 0
  const warnings = checks.filter((c) => c.severity === 'warning' && !c.passed)

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  const doLock = async () => {
    try {
      const lock = lockPeriod({
        ...validationInput,
        companyId,
        lockedBy: 'local-user',
        now: new Date().toISOString(),
      })
      const port = dataPort()
      await port.periodLocks.append(lock)
      await port.audit.append(
        auditEvent(companyId, 'period_locked', `period:${lock.periodKey}`, `Period ${lock.periodKey} locked${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`),
      )
      invalidate(companyId)
      setMessage(`Period ${lock.periodKey} locked. Posting into it is now blocked.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const doUnlock = async (periodKey: string) => {
    const reason = window.prompt(`Unlock ${periodKey}? State the reason (recorded in the audit trail):`)
    if (!reason) return
    const port = dataPort()
    await port.periodLocks.remove(companyId, periodKey)
    await port.audit.append(
      auditEvent(companyId, 'period_unlocked', `period:${periodKey}`, `Period ${periodKey} unlocked: ${reason}`),
    )
    invalidate(companyId)
    setMessage(`Period ${periodKey} unlocked — recorded in the audit trail.`)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-bold">Period close</h1>
        <p className="text-sm text-slate-500">
          Blockers prevent the lock; warnings don't. A locked period rejects all posting;
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
                  c.passed
                    ? 'bg-brand-50 text-brand-700'
                    : c.severity === 'blocker'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-amber-50 text-amber-600'
                }`}
              >
                {c.passed ? '✓' : c.severity === 'blocker' ? '✗' : '!'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {c.label}
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${c.severity === 'blocker' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-600'}`}>
                    {c.severity}
                  </span>
                </p>
                <p className="text-xs text-slate-500">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <button
          disabled={!canLock}
          onClick={() => void doLock()}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Lock period{warnings.length > 0 ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Locked periods</h2>
        <div className="flex flex-wrap gap-2">
          {(locks.data ?? []).length === 0 && <p className="text-sm text-slate-400">None yet.</p>}
          {(locks.data ?? [])
            .slice()
            .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
            .map((l) => (
              <span key={l.periodKey} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium">
                {l.periodKey} 🔒
                <button
                  onClick={() => void doUnlock(l.periodKey)}
                  className="text-xs text-slate-500 underline hover:text-red-600"
                  title="Unlock (audited)"
                >
                  unlock
                </button>
              </span>
            ))}
        </div>
      </section>
    </div>
  )
}
