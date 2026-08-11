import type { CompanyId, ISODate, Period } from './core'
import { comparePeriods, periodEnd, periodKey, periodOfDate, periodStart } from './core'
import type { JournalEntry } from './journal'
import type { Sheet } from './sheets'

/**
 * Period close: validation checks must pass, then the lock blocks any further
 * posting into the period. Enforced in the domain layer — postSheet callers
 * must consult assertPostingAllowed before appending an entry.
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

export interface CloseCheck {
  readonly id: string
  readonly label: string
  readonly passed: boolean
  readonly detail: string
}

/**
 * Pre-close validation. All checks must pass before a lock may be created;
 * the review screen renders these directly.
 */
export function validatePeriodClose(input: {
  period: Period
  sheets: readonly Sheet[]
  entries: readonly JournalEntry[]
  locks: readonly PeriodLock[]
}): CloseCheck[] {
  const { period, sheets, entries, locks } = input
  const from = periodStart(period)
  const to = periodEnd(period)
  const inPeriod = (d: ISODate) => d >= from && d <= to

  const drafts = sheets.filter((s) => s.status === 'draft' && inPeriod(s.date))
  const priorOpen = locks.length
    ? false
    : entries.some((e) => comparePeriods(periodOfDate(e.date), period) < 0)
  const orphanEntries = entries.filter(
    (e) => inPeriod(e.date) && e.sheetId !== null && !sheets.some((s) => s.id === e.sheetId),
  )

  const checks: CloseCheck[] = [
    {
      id: 'no_draft_sheets',
      label: 'All sheets dated in the period are posted or void',
      passed: drafts.length === 0,
      detail: drafts.length
        ? `${drafts.length} draft sheet(s): ${drafts.map((d) => d.documentNo).join(', ')}`
        : 'No open drafts',
    },
    {
      id: 'prior_periods_closed',
      label: 'All earlier periods with activity are locked',
      passed: !priorOpen,
      detail: priorOpen ? 'Earlier periods have postings but no lock' : 'Prior periods closed',
    },
    {
      id: 'entries_reference_sheets',
      label: 'Every sheet-sourced entry references an existing sheet',
      passed: orphanEntries.length === 0,
      detail: orphanEntries.length ? `${orphanEntries.length} orphan entries` : 'No orphans',
    },
    {
      id: 'not_already_locked',
      label: 'Period is not already locked',
      passed: !locks.some((l) => l.periodKey === periodKey(period)),
      detail: 'Lock state',
    },
  ]
  return checks
}

export function lockPeriod(input: {
  companyId: CompanyId
  period: Period
  sheets: readonly Sheet[]
  entries: readonly JournalEntry[]
  locks: readonly PeriodLock[]
  lockedBy: string
  now: string
}): PeriodLock {
  const failed = validatePeriodClose(input).filter((c) => !c.passed)
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
