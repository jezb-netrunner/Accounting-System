import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import { computePercentageTax } from './percentageTax'

describe('percentage tax (Sec. 116)', () => {
  it('computes 3% today', () => {
    expect(computePercentageTax(Money.pesos(100_000), '2026-03-31').format()).toBe('3,000.00')
  })

  it('computes 1% for periods in the CREATE relief window', () => {
    expect(computePercentageTax(Money.pesos(100_000), '2021-09-30').format()).toBe('1,000.00')
  })
})
