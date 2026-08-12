import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import { computePercentageTax, computePercentageTaxQuarter } from './percentageTax'

describe('percentage tax (Sec. 116)', () => {
  it('computes 3% today', () => {
    expect(computePercentageTax(Money.pesos(100_000), '2026-03-31').format()).toBe('3,000.00')
  })

  it('computes 1% for periods in the CREATE relief window', () => {
    expect(computePercentageTax(Money.pesos(100_000), '2021-09-30').format()).toBe('1,000.00')
  })
})

describe('computePercentageTaxQuarter (basis-aware)', () => {
  const input = {
    accruedGrossSales: Money.pesos(500_000),
    cashCollections: Money.pesos(420_000),
  }

  it('taxes invoiced sales under the accrual basis', () => {
    const r = computePercentageTaxQuarter({ ...input, basis: 'accrual' }, '2026-03-31')
    expect(r.base.format()).toBe('500,000.00')
    expect(r.tax.format()).toBe('15,000.00')
  })

  it('taxes collections under the cash basis', () => {
    const r = computePercentageTaxQuarter({ ...input, basis: 'cash' }, '2026-03-31')
    expect(r.base.format()).toBe('420,000.00')
    expect(r.tax.format()).toBe('12,600.00')
  })

  it('resolves the rate from the quarter-end date', () => {
    const r = computePercentageTaxQuarter({ ...input, basis: 'accrual' }, '2021-09-30')
    expect(r.tax.format()).toBe('5,000.00')
  })
})
