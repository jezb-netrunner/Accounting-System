import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import {
  computeCompensationWithholding,
  computeFringeBenefitsTax,
  computeWithholding,
} from './withholding'

const D = '2026-02-10'

describe('expanded withholding (ATC × base)', () => {
  it('computes professional fees at the lower tier', () => {
    const r = computeWithholding('WI010', Money.pesos(50_000), D)
    expect(r.amount.format()).toBe('2,500.00') // 5%
    expect(r.higherTierApplied).toBe(false)
    expect(r.kind).toBe('expanded')
  })

  it('steps to 10% when cumulative annual gross crosses ₱3M', () => {
    const r = computeWithholding('WI010', Money.pesos(50_000), D, {
      cumulativeAnnualGross: Money.pesos(2_990_000),
    })
    expect(r.higherTierApplied).toBe(true)
    expect(r.amount.format()).toBe('5,000.00')
  })

  it('corporate professional services step at ₱720k', () => {
    const below = computeWithholding('WC010', Money.pesos(100_000), D)
    expect(below.amount.format()).toBe('10,000.00')
    const above = computeWithholding('WC010', Money.pesos(100_000), D, {
      cumulativeAnnualGross: Money.pesos(700_000),
    })
    expect(above.amount.format()).toBe('15,000.00')
  })

  it('TWA purchase of goods withholds 1%', () => {
    const r = computeWithholding('WC158', Money.pesos(200_000), D)
    expect(r.amount.format()).toBe('2,000.00')
  })

  it('rejects unknown ATCs with a pointer to the rules table', () => {
    expect(() => computeWithholding('WI999', Money.pesos(1), D)).toThrow(/rules table/)
  })
})

describe('final withholding', () => {
  it('dividends to individuals withhold 10% final', () => {
    const r = computeWithholding('WI202', Money.pesos(80_000), D)
    expect(r.kind).toBe('final')
    expect(r.amount.format()).toBe('8,000.00')
  })
})

describe('withholding on compensation', () => {
  it('zero below the monthly floor', () => {
    expect(computeCompensationWithholding(Money.parse('20833.00'), D).isZero()).toBe(true)
  })

  it('applies the 2023+ monthly table', () => {
    // 30,000: 15% of (30,000 − 20,833) = 1,375.05
    expect(computeCompensationWithholding(Money.pesos(30_000), D).format()).toBe('1,375.05')
    // 80,000: 8,541.80 + 25% of (80,000 − 66,667) = 11,875.05
    expect(computeCompensationWithholding(Money.pesos(80_000), D).format()).toBe('11,875.05')
  })

  it('uses the 2018-2022 table for historical payroll', () => {
    // 30,000 in 2022: 20% of (30,000 − 20,833) = 1,833.40
    expect(computeCompensationWithholding(Money.pesos(30_000), '2022-06-15').format()).toBe(
      '1,833.40',
    )
  })
})

describe('fringe benefits tax', () => {
  it('grosses up at 65% and taxes at 35%', () => {
    const r = computeFringeBenefitsTax(Money.pesos(65_000), D)
    expect(r.grossedUpValue.format()).toBe('100,000.00')
    expect(r.tax.format()).toBe('35,000.00')
  })
})
