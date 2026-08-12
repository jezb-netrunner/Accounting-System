import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import {
  annualizeYearEnd,
  atcSummary,
  certificateData,
  computePayrollWithholding,
  qapEntries,
  twaDefaultAtc,
  withholdingForMonth,
  type WithholdingTxn,
} from './withholdingPeriod'
import { VAT_CORPORATION_PROFILE, PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE } from '../../seed/profiles'

const P = (pesos: number) => Money.pesos(pesos)

const txn = (
  date: string,
  payeeId: string,
  atc: string,
  base: number,
  amount: number,
  kind: 'expanded' | 'final' = 'expanded',
): WithholdingTxn => ({ date, payeeId, atc, base: P(base), amount: P(amount), kind })

const Q1: WithholdingTxn[] = [
  txn('2026-01-15', 'A', 'WC100', 100_000, 5_000),
  txn('2026-02-10', 'A', 'WC100', 50_000, 2_500),
  txn('2026-02-20', 'B', 'WI010', 200_000, 10_000),
  txn('2026-03-05', 'A', 'WC010', 30_000, 3_000),
  txn('2026-03-09', 'C', 'WI202', 100_000, 10_000, 'final'),
]

describe('withholding remittance aggregation', () => {
  it('totals a month for the expanded track only', () => {
    expect(withholdingForMonth(Q1, 2026, 1, 'expanded').format()).toBe('5,000.00')
    expect(withholdingForMonth(Q1, 2026, 2, 'expanded').format()).toBe('12,500.00')
    expect(withholdingForMonth(Q1, 2026, 3, 'expanded').format()).toBe('3,000.00')
  })

  it('keeps the final track completely separate', () => {
    expect(withholdingForMonth(Q1, 2026, 3, 'final').format()).toBe('10,000.00')
    expect(withholdingForMonth(Q1, 2026, 1, 'final').isZero()).toBe(true)
  })

  it('summarizes a quarter by ATC', () => {
    const rows = atcSummary(Q1, '2026-01-01', '2026-03-31', 'expanded')
    expect(rows).toHaveLength(3)
    const wc100 = rows.find((r) => r.atc === 'WC100')!
    expect(wc100.base.format()).toBe('150,000.00')
    expect(wc100.withheld.format()).toBe('7,500.00')
  })

  it('builds QAP entries per payee per ATC', () => {
    const rows = qapEntries(Q1, '2026-01-01', '2026-03-31', 'expanded')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => `${r.payeeId}:${r.atc}`)).toEqual(['A:WC010', 'A:WC100', 'B:WI010'])
    expect(rows.find((r) => r.atc === 'WC100')!.withheld.format()).toBe('7,500.00')
  })

  it('accumulates 2307 certificate data per payee with month-of-quarter columns', () => {
    const certs = certificateData(Q1, { year: 2026, month: 1 }, 'expanded')
    expect(certs.map((c) => c.payeeId)).toEqual(['A', 'B'])
    const a = certs[0]!
    const wc100 = a.rows.find((r) => r.atc === 'WC100')!
    expect(wc100.monthAmounts.map((m) => m.format())).toEqual(['100,000.00', '50,000.00', '0.00'])
    expect(wc100.taxWithheld.format()).toBe('7,500.00')
    const wc010 = a.rows.find((r) => r.atc === 'WC010')!
    expect(wc010.monthAmounts.map((m) => m.format())).toEqual(['0.00', '0.00', '30,000.00'])
    expect(a.totalBase.format()).toBe('180,000.00')
    expect(a.totalWithheld.format()).toBe('10,500.00')
  })

  it('issues final-withholding certificates on their own track', () => {
    const certs = certificateData(Q1, { year: 2026, month: 1 }, 'final')
    expect(certs.map((c) => c.payeeId)).toEqual(['C'])
    expect(certs[0]!.totalWithheld.format()).toBe('10,000.00')
  })
})

describe('twaDefaultAtc', () => {
  it('drives goods/services ATCs off the Top Withholding Agent flag', () => {
    expect(twaDefaultAtc(VAT_CORPORATION_PROFILE, 'corporation', 'goods')).toBe('WC158')
    expect(twaDefaultAtc(VAT_CORPORATION_PROFILE, 'individual', 'services')).toBe('WI160')
  })

  it('returns null for non-TWA companies', () => {
    expect(twaDefaultAtc(PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE, 'corporation', 'goods')).toBeNull()
  })
})

describe('computePayrollWithholding', () => {
  const D = '2026-01-31'
  const base = {
    frequency: 'monthly' as const,
    basicPay: Money.ZERO,
    otherTaxable: Money.ZERO,
    thirteenthMonthAndOtherBenefits: Money.ZERO,
    thirteenthMonthYtdBefore: Money.ZERO,
    deMinimis: [],
    mandatoryContributions: Money.ZERO,
  }

  it('applies the monthly table to taxable pay net of mandatory contributions', () => {
    const r = computePayrollWithholding(
      { ...base, basicPay: P(40_000), mandatoryContributions: P(2_000) },
      D,
    )
    expect(r.taxableCompensation.format()).toBe('38,000.00')
    // 1,875 + 20% × (38,000 − 33,333) = 1,875 + 933.40
    expect(r.withholding.format()).toBe('2,808.40')
  })

  it('withholds zero at or below the frequency floor', () => {
    const r = computePayrollWithholding({ ...base, basicPay: P(20_000) }, D)
    expect(r.withholding.isZero()).toBe(true)
  })

  it('uses the semi-monthly column for semi-monthly runs', () => {
    const r = computePayrollWithholding(
      { ...base, frequency: 'semi_monthly', basicPay: Money.parse('12500.00') },
      D,
    )
    // (12,500 − 10,417) × 15% = 312.45
    expect(r.withholding.format()).toBe('312.45')
  })

  it('uses the 2018-2022 table for historical payroll dates', () => {
    const r = computePayrollWithholding({ ...base, basicPay: P(25_000) }, '2022-06-30')
    // (25,000 − 20,833) × 20% = 833.40
    expect(r.withholding.format()).toBe('833.40')
  })

  it('excludes de minimis within caps and pushes the excess into the 13th-month bucket', () => {
    const r = computePayrollWithholding(
      {
        ...base,
        basicPay: P(30_000),
        deMinimis: [{ kind: 'rice_subsidy_monthly', amount: P(3_000) }],
      },
      D,
    )
    expect(r.deMinimisExcess.format()).toBe('1,000.00')
    // Excess rides the 90k 13th-month/other-benefits exclusion, so stays non-taxable here.
    expect(r.taxableCompensation.format()).toBe('30,000.00')
    expect(r.nonTaxableCompensation.format()).toBe('3,000.00')
  })

  it('caps annual-type de minimis using the year-to-date already claimed', () => {
    const r = computePayrollWithholding(
      {
        ...base,
        basicPay: P(30_000),
        deMinimis: [{ kind: 'uniform_allowance_annual', amount: P(5_000), ytdBefore: P(2_000) }],
      },
      D,
    )
    // Cap 6,000/yr, 2,000 used → 4,000 still excludable; 1,000 excess.
    expect(r.deMinimisExcess.format()).toBe('1,000.00')
  })

  it('exempts 13th month and other benefits up to the ₱90k cap only', () => {
    const r = computePayrollWithholding(
      { ...base, basicPay: P(50_000), thirteenthMonthAndOtherBenefits: P(100_000) },
      D,
    )
    expect(r.thirteenthMonthTaxable.format()).toBe('10,000.00')
    expect(r.taxableCompensation.format()).toBe('60,000.00')
  })

  it('respects 13th-month exclusion already consumed earlier in the year', () => {
    const r = computePayrollWithholding(
      {
        ...base,
        basicPay: P(50_000),
        thirteenthMonthAndOtherBenefits: P(30_000),
        thirteenthMonthYtdBefore: P(80_000),
      },
      D,
    )
    // Only 10k of headroom left.
    expect(r.thirteenthMonthTaxable.format()).toBe('20,000.00')
  })

  it('treats unknown de minimis kinds as fully taxable via the excess bucket', () => {
    const r = computePayrollWithholding(
      {
        ...base,
        basicPay: P(30_000),
        thirteenthMonthYtdBefore: P(90_000), // no headroom left
        deMinimis: [{ kind: 'mystery_benefit', amount: P(1_000) }],
      },
      D,
    )
    expect(r.deMinimisExcess.format()).toBe('1,000.00')
    expect(r.taxableCompensation.format()).toBe('31,000.00')
  })
})

describe('annualizeYearEnd', () => {
  it('true-ups the December run against the annual schedule', () => {
    const r = annualizeYearEnd(
      { taxableCompensationYtd: P(300_000), withheldBeforeFinalRun: P(6_000) },
      '2026-12-31',
    )
    // Annual due: (300,000 − 250,000) × 15% = 7,500
    expect(r.annualTaxDue.format()).toBe('7,500.00')
    expect(r.finalWithholding.format()).toBe('1,500.00')
  })

  it('returns a negative final withholding when the year over-withheld (refund)', () => {
    const r = annualizeYearEnd(
      { taxableCompensationYtd: P(300_000), withheldBeforeFinalRun: P(10_000) },
      '2026-12-31',
    )
    expect(r.finalWithholding.format()).toBe('-2,500.00')
  })

  it('uses the schedule in force for the taxable year', () => {
    const r = annualizeYearEnd(
      { taxableCompensationYtd: P(300_000), withheldBeforeFinalRun: Money.ZERO },
      '2022-12-31',
    )
    // 2018-2022: (300,000 − 250,000) × 20% = 10,000
    expect(r.annualTaxDue.format()).toBe('10,000.00')
  })
})
