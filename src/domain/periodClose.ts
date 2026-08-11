import type { Account } from './coa'
import type { CompanyId, ISODate, Period } from './core'
import { comparePeriods, periodEnd, periodKey, periodOfDate, periodStart } from './core'
import type { JournalEntry } from './journal'
import { trialBalance } from './ledger'
import type { Sheet } from './sheets'
import { partyBalances } from './subledger'
import type { TaxProfile } from './taxProfile'
import type { GeneratedReturn } from '../reports/returns/context'
import { Money } from '../lib/money'
import { obligationsArisingFrom } from '../tax/filingCalendar'

/**
 * Period close: the checklist runs real validations against the ledger.
 * Blockers prevent the lock; warnings inform but don't. A lock blocks all
 * posting into the period (enforced in the domain via assertPostingAllowed)
 * and is reversible only through an explicit unlock that the caller must
 * pair with an audit row.
 */

export interface PeriodLock {
  readonly companyId: CompanyId
  readonly periodKey: string // "2026-03"
  readonly lockedAt: string
  readonly lockedBy: string
}

export class PeriodLockedError extends Error {
  constructor(date: ISODate) {
    super(`Period containing ${date} is locked; post a correcting entry in an open period instead`)
  }
}

export function isPeriodLocked(date: ISODate, locks: readonly PeriodLock[]): boolean {
  const key = periodKey(periodOfDate(date))
  return locks.some((l) => l.periodKey === key)
}

export function assertPostingAllowed(date: ISODate, locks: readonly PeriodLock[]): void {
  if (isPeriodLocked(date, locks)) throw new PeriodLockedError(date)
}

export type CheckSeverity = 'blocker' | 'warning'

export interface CloseCheck {
  readonly id: string
  readonly label: string
  readonly severity: CheckSeverity
  readonly passed: boolean
  readonly detail: string
}

export interface CloseValidationInput {
  readonly period: Period
  readonly profile: TaxProfile | null
  readonly sheets: readonly Sheet[]
  readonly entries: readonly JournalEntry[]
  readonly accounts: readonly Account[]
  readonly locks: readonly PeriodLock[]
  readonly generatedReturns: readonly GeneratedReturn[]
  /** Withholding derived from source documents for the period (recon vs ledger). */
  readonly derivedWithholdingCentavos?: number
  /** Output VAT derived from source documents for the period (recon vs ledger). */
  readonly derivedOutputVatCentavos?: number
}

export function validatePeriodClose(input: CloseValidationInput): CloseCheck[] {
  const { period, sheets, entries, accounts, locks } = input
  const from = periodStart(period)
  const to = periodEnd(period)
  const inPeriod = (d: ISODate) => d >= from && d <= to
  const checks: CloseCheck[] = []
  const push = (
    id: string,
    label: string,
    severity: CheckSeverity,
    passed: boolean,
    detail: string,
  ) => checks.push({ id, label, severity, passed, detail })

  // ---- Blockers ----
  const drafts = sheets.filter((s) => s.status === 'draft' && inPeriod(s.date))
  push(
    'no_draft_sheets',
    'All sheets dated in the period are posted or void',
    'blocker',
    drafts.length === 0,
    drafts.length
      ? `${drafts.length} draft sheet(s): ${drafts.map((d) => d.documentNo || '(no №)').join(', ')}`
      : 'No open drafts',
  )

  const priorOpen =
    entries.some((e) => comparePeriods(periodOfDate(e.date), period) < 0) &&
    !entries
      .filter((e) => comparePeriods(periodOfDate(e.date), period) < 0)
      .every((e) => locks.some((l) => l.periodKey === periodKey(periodOfDate(e.date))))
  push(
    'prior_periods_closed',
    'All earlier periods with activity are locked',
    'blocker',
    !priorOpen,
    priorOpen ? 'Earlier periods have postings but no lock' : 'Prior periods closed',
  )

  const orphanEntries = entries.filter(
    (e) => inPeriod(e.date) && e.sheetId !== null && !sheets.some((s) => s.id === e.sheetId),
  )
  push(
    'entries_reference_sheets',
    'Every sheet-sourced entry references an existing sheet',
    'blocker',
    orphanEntries.length === 0,
    orphanEntries.length ? `${orphanEntries.length} orphan entries` : 'No orphans',
  )

  const tb = trialBalance(entries, accounts, to)
  push(
    'trial_balance_ties',
    'Trial balance ties (total debits equal total credits)',
    'blocker',
    tb.totalDebit.equals(tb.totalCredit),
    `Debits ${tb.totalDebit.format()} / credits ${tb.totalCredit.format()}`,
  )

  push(
    'not_already_locked',
    'Period is not already locked',
    'blocker',
    !locks.some((l) => l.periodKey === periodKey(period)),
    'Lock state',
  )

  // ---- Warnings ----
  for (const role of ['accounts_receivable', 'accounts_payable'] as const) {
    const codes = new Set(accounts.filter((a) => a.systemRole === role).map((a) => a.code))
    let control = 0
    for (const e of entries) {
      if (e.date > to) continue
      for (const l of e.lines) if (codes.has(l.accountCode)) control += l.debitCentavos - l.creditCentavos
    }
    const sub = partyBalances(entries, codes, to).reduce((a, b) => a + b.balance.centavos, 0)
    const diff = control - sub
    push(
      `subledger_${role}`,
      `${role === 'accounts_receivable' ? 'AR' : 'AP'} subsidiary ledger agrees with the control account`,
      'warning',
      diff === 0,
      diff === 0
        ? 'Ties to the centavo'
        : `${Money.fromCentavos(Math.abs(diff)).format()} in the control account is not attributed to any party`,
    )
  }

  const tagOf = new Map(accounts.map((a) => [a.code, a.taxTag]))
  const tagSum = (tag: string, side: 'credit' | 'debit') => {
    let c = 0
    for (const e of entries) {
      if (!inPeriod(e.date)) continue
      for (const l of e.lines) {
        if (tagOf.get(l.accountCode) !== tag) continue
        c += side === 'credit' ? l.creditCentavos - l.debitCentavos : l.debitCentavos - l.creditCentavos
      }
    }
    return c
  }

  if (input.profile?.registeredTaxTypes.has('vat')) {
    const ledgerOutputVat = tagSum('output_vat', 'credit')
    const derived = input.derivedOutputVatCentavos
    push(
      'vat_base_recon',
      'Output VAT in the ledger reconciles to VAT derived from posted documents',
      'warning',
      derived === undefined || derived === ledgerOutputVat,
      derived === undefined
        ? `Ledger output VAT ${Money.fromCentavos(ledgerOutputVat).format()} (no document-derived figure supplied)`
        : `Ledger ${Money.fromCentavos(ledgerOutputVat).format()} vs documents ${Money.fromCentavos(derived).format()}`,
    )
  }

  if (input.profile?.registeredTaxTypes.has('withholding_expanded')) {
    const ledgerEwt = tagSum('ewt_payable', 'credit')
    const derived = input.derivedWithholdingCentavos
    push(
      'withholding_recon',
      'Withholding payable in the ledger reconciles to withholding derived from posted documents',
      'warning',
      derived === undefined || derived === ledgerEwt,
      derived === undefined
        ? `Ledger EWT ${Money.fromCentavos(ledgerEwt).format()} (no document-derived figure supplied)`
        : `Ledger ${Money.fromCentavos(ledgerEwt).format()} vs documents ${Money.fromCentavos(derived).format()}`,
    )
  }

  if (input.profile) {
    const due = obligationsArisingFrom(input.profile, period)
    const missing = due.filter(
      (o) =>
        !input.generatedReturns.some(
          (g) => g.formCode === o.formCode && g.periodTo === o.periodCovered.to,
        ),
    )
    push(
      'returns_generated',
      'Every return arising from this period has been generated',
      'warning',
      missing.length === 0,
      missing.length
        ? `Missing: ${missing.map((m) => m.formCode).join(', ')}`
        : due.length
          ? `${due.length} return(s) generated`
          : 'Nothing arises from this period',
    )
  }

  return checks
}

export const blockersPass = (checks: readonly CloseCheck[]): boolean =>
  checks.filter((c) => c.severity === 'blocker').every((c) => c.passed)

export function lockPeriod(
  input: CloseValidationInput & { companyId: CompanyId; lockedBy: string; now: string },
): PeriodLock {
  const failed = validatePeriodClose(input).filter((c) => c.severity === 'blocker' && !c.passed)
  if (failed.length) {
    throw new Error(
      `Cannot close ${periodKey(input.period)}: ${failed.map((f) => f.label).join('; ')}`,
    )
  }
  return {
    companyId: input.companyId,
    periodKey: periodKey(input.period),
    lockedAt: input.now,
    lockedBy: input.lockedBy,
  }
}
