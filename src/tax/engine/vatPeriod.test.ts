import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import {
  amortizedInputVatForWindow,
  buildCapitalGoodsSchedule,
  computeVatPeriod,
  type VatPeriodInput,
} from './vatPeriod'

const P = (pesos: number) => Money.pesos(pesos)

const baseInput = (over: Partial<VatPeriodInput> = {}): VatPeriodInput => ({
  outputVat: Money.ZERO,
  inputVatDirectTaxable: Money.ZERO,
  inputVatDirectExempt: Money.ZERO,
  inputVatCommon: Money.ZERO,
  amortizedInputVatThisPeriod: Money.ZERO,
  sales: { vatable: Money.ZERO, zeroRated: Money.ZERO, exempt: Money.ZERO },
  excessInputVatCarriedForward: Money.ZERO,
  vatWithheldByGovernment: Money.ZERO,
  ...over,
})

describe('computeVatPeriod', () => {
  it('nets output VAT against every credit class and pays the remainder', () => {
    const r = computeVatPeriod(
      baseInput({
        outputVat: P(120_000),
        inputVatDirectTaxable: P(30_000),
        inputVatDirectExempt: P(5_000),
        inputVatCommon: P(12_000),
        amortizedInputVatThisPeriod: P(1_000),
        sales: { vatable: P(600_000), zeroRated: P(300_000), exempt: P(100_000) },
        excessInputVatCarriedForward: P(2_000),
        vatWithheldByGovernment: P(1_000),
      }),
    )
    // Common input VAT splits 900:100 taxable:exempt.
    expect(r.commonAllocatedToTaxable.format()).toBe('10,800.00')
    expect(r.commonAllocatedToExempt.format()).toBe('1,200.00')
    // Directly-attributable-to-exempt input VAT is never creditable.
    expect(r.creditableInputVat.format()).toBe('41,800.00') // 30,000 + 10,800 + 1,000
    expect(r.inputVatExpensed.format()).toBe('6,200.00') // 5,000 + 1,200
    expect(r.totalAvailableCredits.format()).toBe('44,800.00') // + 2,000 c/f + 1,000 gov
    expect(r.netVatPayable.format()).toBe('75,200.00')
    expect(r.excessInputVatCarryForward.isZero()).toBe(true)
  })

  it('carries excess input VAT forward instead of losing it', () => {
    const r = computeVatPeriod(
      baseInput({
        outputVat: P(10_000),
        inputVatDirectTaxable: P(12_000),
        sales: { vatable: P(100_000), zeroRated: Money.ZERO, exempt: Money.ZERO },
        excessInputVatCarriedForward: P(3_000),
      }),
    )
    expect(r.netVatPayable.isZero()).toBe(true)
    expect(r.excessInputVatCarryForward.format()).toBe('5,000.00')
  })

  it('reallocates common input VAT when the period sales mix changes', () => {
    const mixed = (vatable: number, exempt: number) =>
      computeVatPeriod(
        baseInput({
          inputVatCommon: P(12_000),
          sales: { vatable: P(vatable), zeroRated: Money.ZERO, exempt: P(exempt) },
        }),
      )
    expect(mixed(900_000, 100_000).commonAllocatedToTaxable.format()).toBe('10,800.00')
    expect(mixed(500_000, 500_000).commonAllocatedToTaxable.format()).toBe('6,000.00')
    expect(mixed(500_000, 500_000).commonAllocatedToExempt.format()).toBe('6,000.00')
  })

  it('treats input VAT attributable to zero-rated sales as creditable', () => {
    const r = computeVatPeriod(
      baseInput({
        inputVatCommon: P(10_000),
        sales: { vatable: P(400_000), zeroRated: P(400_000), exempt: P(200_000) },
      }),
    )
    expect(r.commonAllocatedToTaxable.format()).toBe('8,000.00')
    expect(r.commonAllocatedToExempt.format()).toBe('2,000.00')
  })

  it('parks common input VAT as creditable when the period has no sales', () => {
    const r = computeVatPeriod(baseInput({ inputVatCommon: P(7_000) }))
    expect(r.creditableInputVat.format()).toBe('7,000.00')
    expect(r.excessInputVatCarryForward.format()).toBe('7,000.00')
  })

  it('never loses a centavo across the common allocation', () => {
    const r = computeVatPeriod(
      baseInput({
        inputVatCommon: Money.fromCentavos(10_001),
        sales: { vatable: P(1), zeroRated: P(1), exempt: P(1) },
      }),
    )
    expect(r.commonAllocatedToTaxable.add(r.commonAllocatedToExempt).centavos).toBe(10_001)
  })
})

describe('capital goods input VAT amortization', () => {
  const pre2022 = {
    acquisitionDate: '2021-06-15',
    inputVat: P(600_000),
    usefulLifeMonths: 72,
    monthlyAggregateAcquisitionCost: P(5_000_000),
  }

  it('amortizes a pre-2022 acquisition over min(useful life, 60) months', () => {
    const s = buildCapitalGoodsSchedule(pre2022)
    expect(s.amortized).toBe(true)
    expect(s.months).toBe(60)
    expect(s.monthlyAmounts).toHaveLength(60)
    expect(s.monthlyAmounts[0]!.format()).toBe('10,000.00')
    expect(s.startPeriod).toEqual({ year: 2021, month: 6 })
  })

  it('uses the full useful life when shorter than 60 months', () => {
    const s = buildCapitalGoodsSchedule({ ...pre2022, usefulLifeMonths: 48 })
    expect(s.months).toBe(48)
    expect(s.monthlyAmounts[0]!.format()).toBe('12,500.00')
  })

  it('treats post-sunset acquisitions as fully creditable on purchase', () => {
    const s = buildCapitalGoodsSchedule({ ...pre2022, acquisitionDate: '2022-02-01' })
    expect(s.amortized).toBe(false)
    expect(s.months).toBe(1)
    expect(s.monthlyAmounts[0]!.format()).toBe('600,000.00')
    expect(s.startPeriod).toEqual({ year: 2022, month: 2 })
  })

  it('skips amortization below the monthly aggregate threshold', () => {
    const s = buildCapitalGoodsSchedule({
      ...pre2022,
      acquisitionDate: '2020-05-10',
      monthlyAggregateAcquisitionCost: P(800_000),
    })
    expect(s.amortized).toBe(false)
  })

  it('sums the schedule exactly to the input VAT (no lost centavo)', () => {
    const s = buildCapitalGoodsSchedule({ ...pre2022, inputVat: Money.fromCentavos(10_000_001) })
    const total = s.monthlyAmounts.reduce((a, m) => a.add(m), Money.ZERO)
    expect(total.centavos).toBe(10_000_001)
  })

  it('reports the amortized amount falling inside a period window', () => {
    const running = buildCapitalGoodsSchedule(pre2022) // Jun 2021 + 59 more months
    const outright = buildCapitalGoodsSchedule({ ...pre2022, acquisitionDate: '2022-02-01' })
    // Q3 2021: Jul, Aug, Sep → 3 × 10,000 from the running schedule only.
    expect(amortizedInputVatForWindow([running, outright], '2021-07-01', '2021-09-30').format()).toBe(
      '30,000.00',
    )
    // Q1 2022: Jan-Mar → 3 × 10,000 running + the outright Feb claim.
    expect(amortizedInputVatForWindow([running, outright], '2022-01-01', '2022-03-31').format()).toBe(
      '630,000.00',
    )
    // The schedule ends after 60 months (last month: May 2026).
    expect(amortizedInputVatForWindow([running], '2026-04-01', '2026-06-30').format()).toBe(
      '20,000.00',
    )
    expect(amortizedInputVatForWindow([running], '2026-07-01', '2026-09-30').isZero()).toBe(true)
  })

  it('claims outright under the pre-amortization era rule block (no regime existed)', () => {
    const s = buildCapitalGoodsSchedule({ ...pre2022, acquisitionDate: '2005-03-01' })
    expect(s.amortized).toBe(false)
  })
})
