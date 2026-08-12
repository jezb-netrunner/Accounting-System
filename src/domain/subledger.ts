import { Money } from '../lib/money'
import type { ISODate } from './core'
import type { JournalEntry } from './journal'
import type { LedgerLine } from './ledger'

/**
 * Subsidiary ledgers (AR/AP by party) and aging. Party attribution rides on
 * the journal lines' partyId, so the subledgers always tie to the control
 * accounts by construction — both read the same lines.
 */

export interface PartySubledgerTotals {
  readonly partyId: string
  readonly debit: Money
  readonly credit: Money
  readonly balance: Money
}

/** Balance per party over the control account codes (control-account tie-out). */
export function partyBalances(
  entries: readonly JournalEntry[],
  accountCodes: ReadonlySet<string>,
  asOf: ISODate,
): PartySubledgerTotals[] {
  const acc = new Map<string, { debit: number; credit: number }>()
  for (const e of entries) {
    if (e.date > asOf) continue
    for (const l of e.lines) {
      if (!accountCodes.has(l.accountCode) || !l.partyId) continue
      const row = acc.get(l.partyId) ?? { debit: 0, credit: 0 }
      row.debit += l.debitCentavos
      row.credit += l.creditCentavos
      acc.set(l.partyId, row)
    }
  }
  return [...acc.entries()]
    .map(([partyId, r]) => ({
      partyId,
      debit: Money.fromCentavos(r.debit),
      credit: Money.fromCentavos(r.credit),
      balance: Money.fromCentavos(r.debit - r.credit),
    }))
    .sort((a, b) => a.partyId.localeCompare(b.partyId))
}

/** One party's movements across the control accounts, running balance in order. */
export function partySubledger(
  entries: readonly JournalEntry[],
  accountCodes: ReadonlySet<string>,
  partyId: string,
): LedgerLine[] {
  const out: LedgerLine[] = []
  let balance = Money.ZERO
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? a.entryNo - b.entryNo : a.date.localeCompare(b.date),
  )
  for (const e of sorted) {
    for (const l of e.lines) {
      if (!accountCodes.has(l.accountCode) || l.partyId !== partyId) continue
      balance = balance.add(Money.fromCentavos(l.debitCentavos - l.creditCentavos))
      out.push({
        date: e.date,
        entryNo: e.entryNo,
        description: l.description,
        debit: Money.fromCentavos(l.debitCentavos),
        credit: Money.fromCentavos(l.creditCentavos),
        runningBalance: balance,
      })
    }
  }
  return out
}

export interface AgingBuckets {
  readonly current: Money
  readonly d31_60: Money
  readonly d61_90: Money
  readonly over90: Money
  readonly total: Money
}

const daysBetween = (from: ISODate, to: ISODate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Aging by bucket, FIFO: settlements (credits on an AR-style account) apply
 * against the oldest open charges first, and whatever remains open ages by
 * its own document date. Works for AP by passing the AP account codes — the
 * signs mirror (credits charge, debits settle) via the `normal` parameter.
 */
export function buildPartyAging(
  entries: readonly JournalEntry[],
  accountCodes: ReadonlySet<string>,
  asOf: ISODate,
  normal: 'debit' | 'credit' = 'debit',
): Map<string, AgingBuckets> {
  const charges = new Map<string, { date: ISODate; remaining: number }[]>()
  // Settlements arriving before any charge (advances/overpayments) wait here
  // and absorb the next charges instead of silently disappearing.
  const unapplied = new Map<string, number>()
  const sorted = [...entries]
    .filter((e) => e.date <= asOf)
    .sort((a, b) => (a.date === b.date ? a.entryNo - b.entryNo : a.date.localeCompare(b.date)))

  for (const e of sorted) {
    for (const l of e.lines) {
      if (!accountCodes.has(l.accountCode) || !l.partyId) continue
      const signed =
        normal === 'debit' ? l.debitCentavos - l.creditCentavos : l.creditCentavos - l.debitCentavos
      if (signed === 0) continue
      const open = charges.get(l.partyId) ?? []
      if (signed > 0) {
        let amount = signed
        const advance = unapplied.get(l.partyId) ?? 0
        if (advance > 0) {
          const take = Math.min(advance, amount)
          unapplied.set(l.partyId, advance - take)
          amount -= take
        }
        if (amount > 0) open.push({ date: e.date, remaining: amount })
      } else {
        // Settlement: consume oldest charges first; keep any excess as an
        // advance for future charges (a net credit balance never buckets).
        let toApply = -signed
        for (const c of open) {
          if (toApply === 0) break
          const take = Math.min(c.remaining, toApply)
          c.remaining -= take
          toApply -= take
        }
        if (toApply > 0) unapplied.set(l.partyId, (unapplied.get(l.partyId) ?? 0) + toApply)
      }
      charges.set(l.partyId, open)
    }
  }

  const out = new Map<string, AgingBuckets>()
  for (const [partyId, open] of charges) {
    let current = 0
    let d31 = 0
    let d61 = 0
    let over = 0
    for (const c of open) {
      if (c.remaining === 0) continue
      const age = daysBetween(c.date, asOf)
      if (age <= 30) current += c.remaining
      else if (age <= 60) d31 += c.remaining
      else if (age <= 90) d61 += c.remaining
      else over += c.remaining
    }
    const total = current + d31 + d61 + over
    if (total === 0) continue
    out.set(partyId, {
      current: Money.fromCentavos(current),
      d31_60: Money.fromCentavos(d31),
      d61_90: Money.fromCentavos(d61),
      over90: Money.fromCentavos(over),
      total: Money.fromCentavos(total),
    })
  }
  return out
}
