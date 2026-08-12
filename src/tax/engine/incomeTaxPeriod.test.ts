import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import {
  applyNolco,
  computeCorporateAnnualTax,
  computeCorporateQuarterlyTax,
  computeIndividualQuarterlyTax,
  eightPercentEligibility,
  type CorporateAnnualInput,
  type McitCredit,
  type NolcoVintage,
} from './incomeTaxPeriod'

const P = (pesos: number) => Money.pesos(pesos)

describe('eightPercentEligibility', () => {
  const base = {
    entityType: 'self_employed_professional' as const,
    businessTaxRegime: 'non_vat_percentage' as const,
    grossSalesReceipts: P(2_000_000),
    date: '2026-01-01',
  }

  it('allows a qualifying non-VAT pure business individual', () => {
    expect(eightPercentEligibility(base).eligible).toBe(true)
  })

  it('disqualifies VAT-registered taxpayers', () => {
    const r = eightPercentEligibility({ ...base, businessTaxRegime: 'vat' })
    expect(r.eligible).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/VAT/)
  })

  it('disqualifies gross receipts above the VAT threshold', () => {
    const r = eightPercentEligibility({ ...base, grossSalesReceipts: P(4_000_000) })
    expect(r.eligible).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/threshold/)
  })

  it('disqualifies non-individuals', () => {
    const r = eightPercentEligibility({ ...base, entityType: 'domestic_corporation' })
    expect(r.eligible).toBe(false)
  })
})

describe('computeIndividualQuarterlyTax (cumulative)', () => {
  const base = {
    regime: 'eight_percent' as const,
    ytdGrossSalesReceipts: Money.ZERO,
    ytdCostOfSales: Money.ZERO,
    ytdItemizedDeductions: Money.ZERO,
    ytdOtherTaxableIncome: Money.ZERO,
    taxableCompensationYtd: Money.ZERO,
    isMixedIncome: false,
    priorQuartersPayments: Money.ZERO,
    creditableWithholdingYtd: Money.ZERO,
  }

  it('applies the ₱250k 8% deduction once across cumulative quarters', () => {
    const q1 = computeIndividualQuarterlyTax({ ...base, ytdGrossSalesReceipts: P(400_000) }, '2026-03-31')
    expect(q1.taxDueYtd.format()).toBe('12,000.00') // (400k − 250k) × 8%

    const q2 = computeIndividualQuarterlyTax(
      {
        ...base,
        ytdGrossSalesReceipts: P(1_000_000),
        priorQuartersPayments: P(12_000),
      },
      '2026-06-30',
    )
    expect(q2.taxDueYtd.format()).toBe('60,000.00') // (1M − 250k) × 8%, deduction not doubled
    expect(q2.netPayable.format()).toBe('48,000.00')
  })

  it('nets prior payments and creditable withholding from the YTD due', () => {
    const r = computeIndividualQuarterlyTax(
      {
        ...base,
        regime: 'graduated_osd',
        ytdGrossSalesReceipts: P(1_000_000),
        priorQuartersPayments: P(10_000),
        creditableWithholdingYtd: P(5_000),
      },
      '2026-06-30',
    )
    // OSD: net 600,000 → 22,500 + 20% × 200,000 = 62,500
    expect(r.taxDueYtd.format()).toBe('62,500.00')
    expect(r.netPayable.format()).toBe('47,500.00')
  })

  it('reports an overpayment as a negative net payable', () => {
    const r = computeIndividualQuarterlyTax(
      { ...base, ytdGrossSalesReceipts: P(300_000), priorQuartersPayments: P(10_000) },
      '2026-06-30',
    )
    expect(r.taxDueYtd.format()).toBe('4,000.00')
    expect(r.netPayable.format()).toBe('-6,000.00')
  })
})

describe('computeCorporateQuarterlyTax (cumulative)', () => {
  it('taxes YTD income at the applicable rate less payments and credits', () => {
    const r = computeCorporateQuarterlyTax(
      {
        regime: 'rcit',
        ytdNetTaxableIncome: P(2_000_000),
        ytdGrossIncome: P(5_000_000),
        totalAssetsExclLand: P(50_000_000),
        yearsSinceStartOfOperations: 5,
        isDomestic: true,
        priorQuartersPayments: P(100_000),
        creditableWithholdingYtd: P(50_000),
      },
      '2026-06-30',
    )
    expect(r.taxDueYtd.format()).toBe('400,000.00') // 20% reduced rate
    expect(r.mcit.format()).toBe('100,000.00')
    expect(r.netPayable.format()).toBe('250,000.00')
  })

  it('pays MCIT when it exceeds RCIT on the YTD figures', () => {
    const r = computeCorporateQuarterlyTax(
      {
        regime: 'rcit',
        ytdNetTaxableIncome: P(100_000),
        ytdGrossIncome: P(5_000_000),
        totalAssetsExclLand: P(50_000_000),
        yearsSinceStartOfOperations: 5,
        isDomestic: true,
        priorQuartersPayments: Money.ZERO,
        creditableWithholdingYtd: Money.ZERO,
      },
      '2026-06-30',
    )
    expect(r.taxDueYtd.format()).toBe('100,000.00') // MCIT 2% of 5M > RCIT 20k
  })
})

describe('applyNolco', () => {
  const v = (lossYear: number, amount: number, used = 0): NolcoVintage => ({
    lossYear,
    amount: P(amount),
    used: P(used),
  })

  it('deducts FIFO across vintages up to the available income', () => {
    const r = applyNolco([v(2022, 100_000), v(2023, 200_000)], P(250_000), 2024, '2024-12-31')
    expect(r.deduction.format()).toBe('250,000.00')
    expect(r.updated[0]!.used.format()).toBe('100,000.00')
    expect(r.updated[1]!.used.format()).toBe('150,000.00')
  })

  it('caps the deduction at taxable income before NOLCO', () => {
    const r = applyNolco([v(2022, 500_000)], P(300_000), 2023, '2023-12-31')
    expect(r.deduction.format()).toBe('300,000.00')
    expect(r.updated[0]!.used.format()).toBe('300,000.00')
  })

  it('expires ordinary vintages after the 3-year window', () => {
    const r = applyNolco([v(2022, 500_000)], P(300_000), 2026, '2026-12-31')
    expect(r.deduction.isZero()).toBe(true)
  })

  it('gives 2020/2021 losses the extended 5-year window', () => {
    expect(applyNolco([v(2020, 400_000)], P(100_000), 2025, '2025-12-31').deduction.format()).toBe(
      '100,000.00',
    )
    expect(applyNolco([v(2020, 400_000)], P(100_000), 2026, '2026-12-31').deduction.isZero()).toBe(
      true,
    )
  })

  it('never deducts in the loss year itself or from a loss position', () => {
    expect(applyNolco([v(2024, 100_000)], P(50_000), 2024, '2024-12-31').deduction.isZero()).toBe(true)
    expect(applyNolco([v(2022, 100_000)], P(-50_000), 2023, '2023-12-31').deduction.isZero()).toBe(true)
  })
})

describe('computeCorporateAnnualTax', () => {
  const base: CorporateAnnualInput = {
    regime: 'rcit',
    netTaxableIncomeBeforeNolco: P(400_000),
    grossIncome: P(5_000_000),
    totalAssetsExclLand: P(50_000_000),
    yearsSinceStartOfOperations: 5,
    isDomestic: true,
    taxableYear: 2026,
    nolcoVintages: [],
    mcitCredits: [],
    creditsAndPayments: Money.ZERO,
  }

  it('records excess MCIT as a carry-forward credit when MCIT wins', () => {
    const r = computeCorporateAnnualTax(base, '2026-12-31')
    expect(r.rcit.format()).toBe('80,000.00') // 20% reduced rate
    expect(r.mcit.format()).toBe('100,000.00')
    expect(r.incomeTaxDue.format()).toBe('100,000.00')
    expect(r.newExcessMcit.format()).toBe('20,000.00')
    expect(r.updatedMcitCredits).toHaveLength(1)
    expect(r.updatedMcitCredits[0]).toMatchObject({ year: 2026 })
  })

  it('applies in-window excess MCIT credits against an RCIT year', () => {
    const credits: McitCredit[] = [{ year: 2023, amount: P(20_000), used: Money.ZERO }]
    const r = computeCorporateAnnualTax(
      {
        ...base,
        netTaxableIncomeBeforeNolco: P(750_000),
        grossIncome: P(4_500_000),
        mcitCredits: credits,
        creditsAndPayments: P(30_000),
      },
      '2026-12-31',
    )
    expect(r.rcit.format()).toBe('150,000.00')
    expect(r.incomeTaxDue.format()).toBe('150,000.00')
    expect(r.mcitCreditUsed.format()).toBe('20,000.00')
    expect(r.netPayable.format()).toBe('100,000.00')
  })

  it('refuses expired MCIT credits and credits in an MCIT year', () => {
    const expired: McitCredit[] = [{ year: 2022, amount: P(20_000), used: Money.ZERO }]
    const r = computeCorporateAnnualTax(
      { ...base, netTaxableIncomeBeforeNolco: P(750_000), grossIncome: P(4_500_000), mcitCredits: expired },
      '2026-12-31',
    )
    expect(r.mcitCreditUsed.isZero()).toBe(true)

    const inWindow: McitCredit[] = [{ year: 2024, amount: P(20_000), used: Money.ZERO }]
    const mcitYear = computeCorporateAnnualTax({ ...base, mcitCredits: inWindow }, '2026-12-31')
    expect(mcitYear.incomeTaxDue.format()).toBe('100,000.00') // MCIT year
    expect(mcitYear.mcitCreditUsed.isZero()).toBe(true)
  })

  it('deducts NOLCO before computing RCIT and tracks vintage usage', () => {
    const r = computeCorporateAnnualTax(
      {
        ...base,
        netTaxableIncomeBeforeNolco: P(500_000),
        grossIncome: P(800_000),
        nolcoVintages: [{ lossYear: 2024, amount: P(200_000), used: Money.ZERO }],
      },
      '2026-12-31',
    )
    expect(r.nolcoDeduction.format()).toBe('200,000.00')
    expect(r.taxableIncome.format()).toBe('300,000.00')
    expect(r.rcit.format()).toBe('60,000.00')
    expect(r.updatedNolcoVintages[0]!.used.format()).toBe('200,000.00')
  })

  it('opens a new NOLCO vintage on a loss year', () => {
    const r = computeCorporateAnnualTax(
      { ...base, netTaxableIncomeBeforeNolco: P(-150_000), grossIncome: P(600_000) },
      '2026-12-31',
    )
    expect(r.newNolcoVintage).not.toBeNull()
    expect(r.newNolcoVintage!.amount.format()).toBe('150,000.00')
    expect(r.newNolcoVintage!.lossYear).toBe(2026)
    expect(r.rcit.isZero()).toBe(true)
    // MCIT still applies on gross income in a loss year (year ≥ 4).
    expect(r.incomeTaxDue.format()).toBe('12,000.00')
  })
})
