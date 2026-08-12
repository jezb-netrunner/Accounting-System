import { describe, expect, it } from 'vitest'
import { Money } from '../lib/money'
import { createJournalEntry, type JournalEntry } from './journal'
import { accountLedgerWindow } from './ledger'
import { buildPartyAging, partySubledger } from './subledger'

const AR = '1200'
const SALES = '4100'
const CASH = '1100'

let n = 0
const entry = (date: string, lines: { code: string; debit?: number; credit?: number; partyId?: string }[]): JournalEntry =>
  createJournalEntry({
    id: `e${++n}`,
    companyId: 'co',
    entryNo: n,
    date,
    description: `entry ${n}`,
    postedAt: `${date}T00:00:00Z`,
    lines: lines.map((l) => ({
      accountCode: l.code,
      debit: l.debit ? Money.pesos(l.debit) : undefined,
      credit: l.credit ? Money.pesos(l.credit) : undefined,
      partyId: l.partyId ?? null,
    })),
  })

const invoice = (date: string, party: string, amount: number) =>
  entry(date, [
    { code: AR, debit: amount, partyId: party },
    { code: SALES, credit: amount, partyId: party },
  ])

const collection = (date: string, party: string, amount: number) =>
  entry(date, [
    { code: CASH, debit: amount },
    { code: AR, credit: amount, partyId: party },
  ])

describe('accountLedgerWindow', () => {
  it('reports the opening balance before the window and running balances inside it', () => {
    const entries = [invoice('2026-01-10', 'A', 1_000), invoice('2026-02-05', 'A', 500), collection('2026-02-20', 'A', 800)]
    const w = accountLedgerWindow(entries, AR, '2026-02-01', '2026-02-28')
    expect(w.opening.format()).toBe('1,000.00')
    expect(w.lines).toHaveLength(2)
    expect(w.lines[0]!.runningBalance.format()).toBe('1,500.00')
    expect(w.lines[1]!.runningBalance.format()).toBe('700.00')
    expect(w.closing.format()).toBe('700.00')
  })
})

describe('partySubledger', () => {
  it('runs one party across the AR account only', () => {
    const entries = [
      invoice('2026-01-10', 'A', 1_000),
      invoice('2026-01-15', 'B', 700),
      collection('2026-01-20', 'A', 400),
    ]
    const lines = partySubledger(entries, new Set([AR]), 'A')
    expect(lines).toHaveLength(2)
    expect(lines[1]!.runningBalance.format()).toBe('600.00')
  })
})

describe('buildPartyAging (FIFO application)', () => {
  it('buckets open balances by age of the unapplied invoices', () => {
    const entries = [
      invoice('2025-10-01', 'A', 1_000), // >90 days old at 2026-01-31
      invoice('2026-01-10', 'A', 500), // current
      collection('2026-01-15', 'A', 800), // applies FIFO to the oldest first
    ]
    const aging = buildPartyAging(entries, new Set([AR]), '2026-01-31')
    const a = aging.get('A')!
    // 1,000 − 800 = 200 remains of the October invoice (122 days → over 90)
    expect(a.over90.format()).toBe('200.00')
    expect(a.current.format()).toBe('500.00')
    expect(a.total.format()).toBe('700.00')
  })

  it('buckets 31-60 and 61-90 correctly and ignores fully-settled parties', () => {
    const entries = [
      invoice('2025-12-15', 'A', 300), // 47 days at 2026-01-31 → 31-60
      invoice('2025-11-20', 'A', 200), // 72 days → 61-90
      invoice('2026-01-05', 'B', 100),
      collection('2026-01-06', 'B', 100),
    ]
    const aging = buildPartyAging(entries, new Set([AR]), '2026-01-31')
    const a = aging.get('A')!
    expect(a.d31_60.format()).toBe('300.00')
    expect(a.d61_90.format()).toBe('200.00')
    expect(aging.has('B')).toBe(false)
  })

  it('ignores activity after the as-of date', () => {
    const entries = [invoice('2026-01-10', 'A', 500), collection('2026-02-10', 'A', 500)]
    const aging = buildPartyAging(entries, new Set([AR]), '2026-01-31')
    expect(aging.get('A')!.total.format()).toBe('500.00')
  })

  it('applies advances received before the charge instead of dropping them', () => {
    const entries = [
      collection('2026-01-05', 'A', 300), // customer advance
      invoice('2026-01-20', 'A', 500),
    ]
    const aging = buildPartyAging(entries, new Set([AR]), '2026-01-31')
    expect(aging.get('A')!.total.format()).toBe('200.00')
    expect(aging.get('A')!.current.format()).toBe('200.00')
  })
})
