import type { Account, AccountType } from '../domain/coa'
import type { ISODate } from '../domain/core'
import type { JournalEntry } from '../domain/journal'
import { Money } from '../lib/money'

/**
 * Financial statement models + builders from posted entries. Trial balance
 * lives in src/domain/ledger.ts (it's a domain invariant); these are the
 * presentation-shaped statements.
 */

export interface StatementLine {
  readonly accountCode: string
  readonly label: string
  readonly amount: Money
}

export interface IncomeStatement {
  readonly from: ISODate
  readonly to: ISODate
  readonly income: readonly StatementLine[]
  readonly expenses: readonly StatementLine[]
  readonly totalIncome: Money
  readonly totalExpenses: Money
  readonly netIncome: Money
}

export interface BalanceSheet {
  readonly asOf: ISODate
  readonly assets: readonly StatementLine[]
  readonly liabilities: readonly StatementLine[]
  readonly equity: readonly StatementLine[]
  readonly totalAssets: Money
  readonly totalLiabilities: Money
  readonly totalEquity: Money
}

export interface CashFlowStatement {
  readonly from: ISODate
  readonly to: ISODate
  readonly operating: readonly StatementLine[]
  readonly investing: readonly StatementLine[]
  readonly financing: readonly StatementLine[]
  readonly netChange: Money
}

/** Net movement per account over a window: debit-positive. */
function movements(
  entries: readonly JournalEntry[],
  filter: (date: ISODate) => boolean,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entries) {
    if (!filter(e.date)) continue
    for (const l of e.lines) {
      m.set(l.accountCode, (m.get(l.accountCode) ?? 0) + l.debitCentavos - l.creditCentavos)
    }
  }
  return m
}

function linesFor(
  balances: Map<string, number>,
  accounts: readonly Account[],
  type: AccountType,
  sign: 1 | -1,
): StatementLine[] {
  return accounts
    .filter((a) => a.type === type && a.postable)
    .map((a) => ({
      accountCode: a.code,
      label: a.name,
      amount: Money.fromCentavos(sign * (balances.get(a.code) ?? 0)),
    }))
    .filter((l) => !l.amount.isZero())
}

const total = (lines: readonly StatementLine[]) =>
  lines.reduce((acc, l) => acc.add(l.amount), Money.ZERO)

export function buildIncomeStatement(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  from: ISODate,
  to: ISODate,
): IncomeStatement {
  const m = movements(entries, (d) => d >= from && d <= to)
  const income = linesFor(m, accounts, 'income', -1) // credit-normal
  const expenses = linesFor(m, accounts, 'expense', 1)
  const totalIncome = total(income)
  const totalExpenses = total(expenses)
  return {
    from,
    to,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    netIncome: totalIncome.subtract(totalExpenses),
  }
}

export function buildBalanceSheet(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOf: ISODate,
): BalanceSheet {
  const m = movements(entries, (d) => d <= asOf)
  const assets = linesFor(m, accounts, 'asset', 1)
  const liabilities = linesFor(m, accounts, 'liability', -1)
  const equity = linesFor(m, accounts, 'equity', -1)
  // Fold cumulative net income into equity so the sheet balances pre-closing.
  const income = total(linesFor(m, accounts, 'income', -1))
  const expenses = total(linesFor(m, accounts, 'expense', 1))
  const netIncome = income.subtract(expenses)
  const equityWithEarnings = netIncome.isZero()
    ? equity
    : [...equity, { accountCode: '', label: 'Current earnings (unclosed)', amount: netIncome }]
  return {
    asOf,
    assets,
    liabilities,
    equity: equityWithEarnings,
    totalAssets: total(assets),
    totalLiabilities: total(liabilities),
    totalEquity: total(equityWithEarnings),
  }
}

/**
 * Indirect-method cash flow, simplified for the scaffold: operating = net
 * income ± working-capital movements; investing = PPE-type assets; financing
 * = equity movements. A production classification map comes later.
 */
export function buildCashFlow(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  from: ISODate,
  to: ISODate,
): CashFlowStatement {
  const m = movements(entries, (d) => d >= from && d <= to)
  const cashCodes = new Set(
    accounts.filter((a) => a.systemRole === 'cash' || a.code === '1110').map((a) => a.code),
  )
  const netChange = Money.fromCentavos(
    [...m.entries()].filter(([code]) => cashCodes.has(code)).reduce((acc, [, v]) => acc + v, 0),
  )
  const isInvesting = (a: Account) => a.type === 'asset' && /property|equipment/i.test(a.name)
  const isFinancing = (a: Account) => a.type === 'equity'
  const nonCash = accounts.filter((a) => a.postable && !cashCodes.has(a.code))
  const line = (a: Account): StatementLine => ({
    accountCode: a.code,
    label: a.name,
    // Cash-flow sign: a decrease in a non-cash asset frees cash.
    amount: Money.fromCentavos(-(m.get(a.code) ?? 0)),
  })
  const investing = nonCash.filter(isInvesting).map(line).filter((l) => !l.amount.isZero())
  const financing = nonCash.filter(isFinancing).map(line).filter((l) => !l.amount.isZero())
  const operating = nonCash
    .filter((a) => !isInvesting(a) && !isFinancing(a))
    .map(line)
    .filter((l) => !l.amount.isZero())
  return { from, to, operating, investing, financing, netChange }
}
