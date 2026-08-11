import { Money } from '../lib/money'
import type { Account } from './coa'
import type { ISODate } from './core'
import type { JournalEntry } from './journal'

export interface TrialBalanceRow {
  readonly accountCode: string
  readonly accountName: string
  readonly debit: Money
  readonly credit: Money
}

export interface TrialBalance {
  readonly asOf: ISODate
  readonly rows: readonly TrialBalanceRow[]
  readonly totalDebit: Money
  readonly totalCredit: Money
}

/**
 * Trial balance from posted entries. Because every entry balanced at
 * construction, total debits always equal total credits — the TB ties by
 * construction, and the test proves it under random entry mixes.
 */
export function trialBalance(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOf: ISODate,
): TrialBalance {
  const balances = new Map<string, number>()
  for (const entry of entries) {
    if (entry.date > asOf) continue
    for (const line of entry.lines) {
      balances.set(
        line.accountCode,
        (balances.get(line.accountCode) ?? 0) + line.debitCentavos - line.creditCentavos,
      )
    }
  }
  const nameOf = new Map(accounts.map((a) => [a.code, a.name]))
  const rows: TrialBalanceRow[] = [...balances.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, net]) => ({
      accountCode: code,
      accountName: nameOf.get(code) ?? code,
      debit: Money.fromCentavos(net > 0 ? net : 0),
      credit: Money.fromCentavos(net < 0 ? -net : 0),
    }))
    .filter((r) => !r.debit.isZero() || !r.credit.isZero())
  return {
    asOf,
    rows,
    totalDebit: rows.reduce((acc, r) => acc.add(r.debit), Money.ZERO),
    totalCredit: rows.reduce((acc, r) => acc.add(r.credit), Money.ZERO),
  }
}

/** Ledger of one account: running balance in entry order. */
export interface LedgerLine {
  readonly date: ISODate
  readonly entryNo: number
  readonly description: string
  readonly debit: Money
  readonly credit: Money
  readonly runningBalance: Money
}

export function accountLedger(
  entries: readonly JournalEntry[],
  accountCode: string,
): LedgerLine[] {
  const out: LedgerLine[] = []
  let balance = Money.ZERO
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? a.entryNo - b.entryNo : a.date.localeCompare(b.date),
  )
  for (const entry of sorted) {
    for (const line of entry.lines) {
      if (line.accountCode !== accountCode) continue
      balance = balance.add(Money.fromCentavos(line.debitCentavos - line.creditCentavos))
      out.push({
        date: entry.date,
        entryNo: entry.entryNo,
        description: line.description,
        debit: Money.fromCentavos(line.debitCentavos),
        credit: Money.fromCentavos(line.creditCentavos),
        runningBalance: balance,
      })
    }
  }
  return out
}
