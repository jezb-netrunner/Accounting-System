import { describe, expect, it } from 'vitest'
import { Money } from '../lib/money'
import { createJournalEntry, reverseEntry, UnbalancedEntryError } from './journal'

const base = {
  id: 'je-1',
  companyId: 'co-1',
  entryNo: 1,
  date: '2026-03-15',
  description: 'test entry',
  postedAt: '2026-03-15T08:00:00Z',
}

describe('createJournalEntry', () => {
  it('accepts a balanced entry', () => {
    const e = createJournalEntry({
      ...base,
      lines: [
        { accountCode: '1200', debit: Money.pesos(112) },
        { accountCode: '4100', credit: Money.pesos(100) },
        { accountCode: '2200', credit: Money.pesos(12) },
      ],
    })
    expect(e.lines).toHaveLength(3)
  })

  it('rejects an unbalanced entry', () => {
    expect(() =>
      createJournalEntry({
        ...base,
        lines: [
          { accountCode: '1200', debit: Money.pesos(100) },
          { accountCode: '4100', credit: Money.pesos(99) },
        ],
      }),
    ).toThrow(UnbalancedEntryError)
  })

  it('rejects a line that is both debit and credit', () => {
    expect(() =>
      createJournalEntry({
        ...base,
        lines: [
          { accountCode: '1200', debit: Money.pesos(1), credit: Money.pesos(1) },
          { accountCode: '4100', credit: Money.ZERO },
        ],
      }),
    ).toThrow(/either a debit or a credit/)
  })

  it('rejects negative amounts (swap the side instead)', () => {
    expect(() =>
      createJournalEntry({
        ...base,
        lines: [
          { accountCode: '1200', debit: Money.pesos(-5) },
          { accountCode: '4100', credit: Money.pesos(-5) },
        ],
      }),
    ).toThrow(/negative/)
  })

  it('drops zero lines but requires two real ones', () => {
    expect(() =>
      createJournalEntry({
        ...base,
        lines: [
          { accountCode: '1200', debit: Money.pesos(5) },
          { accountCode: '2200', credit: Money.ZERO },
          { accountCode: '4100', credit: Money.pesos(5) },
        ],
      }),
    ).not.toThrow()
    expect(() =>
      createJournalEntry({ ...base, lines: [{ accountCode: '1200', debit: Money.ZERO }] }),
    ).toThrow(/at least two/)
  })

  it('returns a deeply frozen (immutable) entry', () => {
    const e = createJournalEntry({
      ...base,
      lines: [
        { accountCode: '1200', debit: Money.pesos(10) },
        { accountCode: '4100', credit: Money.pesos(10) },
      ],
    })
    expect(Object.isFrozen(e)).toBe(true)
    expect(Object.isFrozen(e.lines)).toBe(true)
    expect(Object.isFrozen(e.lines[0])).toBe(true)
    expect(() => {
      // @ts-expect-error mutation must fail at compile time too
      e.lines[0].debitCentavos = 999
    }).toThrow()
  })
})

describe('reverseEntry', () => {
  it('creates a mirrored entry cross-referencing the original, leaving it untouched', () => {
    const original = createJournalEntry({
      ...base,
      lines: [
        { accountCode: '1200', debit: Money.pesos(112) },
        { accountCode: '4100', credit: Money.pesos(100) },
        { accountCode: '2200', credit: Money.pesos(12) },
      ],
    })
    const reversal = reverseEntry(original, {
      id: 'je-2',
      entryNo: 2,
      date: '2026-03-20',
      postedAt: '2026-03-20T08:00:00Z',
      reason: 'wrong customer',
    })
    expect(reversal.reversalOfEntryId).toBe('je-1')
    expect(reversal.lines[0]!.creditCentavos).toBe(11_200)
    expect(reversal.lines[1]!.debitCentavos).toBe(10_000)
    // original untouched
    expect(original.lines[0]!.debitCentavos).toBe(11_200)
  })
})
