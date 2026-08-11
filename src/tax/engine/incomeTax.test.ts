import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import { computeCorporateIncomeTax, computeIndividualIncomeTax } from './incomeTax'

const YE_2026 = '2026-12-31'

const individualBase = {
  grossSalesReceipts: Money.ZERO,
  costOfSales: Money.ZERO,
  itemizedDeductions: Money.ZERO,
  taxableCompensation: Money.ZERO,
  otherTaxableIncome: Money.ZERO,
  isMixedIncome: false,
}

describe('individual income tax — graduated', () => {
  it('applies the 2023+ schedule with itemized deductions', () => {
    const r = computeIndividualIncomeTax(
      {
        ...individualBase,
        regime: 'graduated_itemized',
        grossSalesReceipts: Money.pesos(1_200_000),
        costOfSales: Money.pesos(400_000),
        itemizedDeductions: Money.pesos(200_000),
      },
      YE_2026,
    )
    // Taxable 600,000 → 22,500 + 20% × 200,000 = 62,500
    expect(r.taxableIncome.format()).toBe('600,000.00')
    expect(r.incomeTaxDue.format()).toBe('62,500.00')
  })

  it('computes OSD as 40% of gross sales/receipts', () => {
    const r = computeIndividualIncomeTax(
      {
        ...individualBase,
        regime: 'graduated_osd',
        grossSalesReceipts: Money.pesos(1_000_000),
        // cost/itemized are ignored under OSD
        costOfSales: Money.pesos(999_999),
      },
      YE_2026,
    )
    // Taxable 600,000 → 62,500
    expect(r.incomeTaxDue.format()).toBe('62,500.00')
  })

  it('uses the harsher 2018-2022 schedule for historical years', () => {
    const r = computeIndividualIncomeTax(
      {
        ...individualBase,
        regime: 'graduated_itemized',
        grossSalesReceipts: Money.pesos(1_000_000),
      },
      '2022-12-31',
    )
    // 2022: 130,000 + 30% × 200,000 = 190,000 (2023+: 152,500)
    expect(r.incomeTaxDue.format()).toBe('190,000.00')
  })

  it('is zero at or below the ₱250k exemption', () => {
    const r = computeIndividualIncomeTax(
      { ...individualBase, regime: 'graduated_itemized', grossSalesReceipts: Money.pesos(250_000) },
      YE_2026,
    )
    expect(r.incomeTaxDue.isZero()).toBe(true)
  })
})

describe('individual income tax — 8% option', () => {
  it('taxes gross receipts less ₱250k for pure business income', () => {
    const r = computeIndividualIncomeTax(
      { ...individualBase, regime: 'eight_percent', grossSalesReceipts: Money.pesos(1_000_000) },
      YE_2026,
    )
    expect(r.incomeTaxDue.format()).toBe('60,000.00')
    expect(r.method).toBe('eight_percent')
  })

  it('denies the ₱250k deduction to mixed-income earners and taxes compensation on brackets', () => {
    const r = computeIndividualIncomeTax(
      {
        ...individualBase,
        regime: 'eight_percent',
        grossSalesReceipts: Money.pesos(1_000_000),
        taxableCompensation: Money.pesos(600_000),
        isMixedIncome: true,
      },
      YE_2026,
    )
    // 8% × 1,000,000 = 80,000; compensation 600,000 → 62,500
    expect(r.incomeTaxDue.format()).toBe('142,500.00')
  })
})

describe('corporate income tax', () => {
  const corpBase = {
    netTaxableIncome: Money.pesos(4_000_000),
    grossIncome: Money.pesos(10_000_000),
    totalAssetsExclLand: Money.pesos(50_000_000),
    yearsSinceStartOfOperations: 2,
    isDomestic: true,
  }

  it('applies the 20% reduced rate to qualifying small domestic corporations', () => {
    const r = computeCorporateIncomeTax({ ...corpBase, regime: 'rcit' }, YE_2026)
    expect(r.rcit.format()).toBe('800,000.00')
    expect(r.mcitApplies).toBe(false)
  })

  it('applies 25% when net income exceeds the ₱5M cap', () => {
    const r = computeCorporateIncomeTax(
      { ...corpBase, regime: 'rcit', netTaxableIncome: Money.pesos(6_000_000) },
      YE_2026,
    )
    expect(r.rcit.format()).toBe('1,500,000.00')
  })

  it('MCIT (2%) kicks in from year 4 and overrides a lower RCIT', () => {
    const r = computeCorporateIncomeTax(
      {
        ...corpBase,
        regime: 'rcit',
        netTaxableIncome: Money.pesos(500_000),
        yearsSinceStartOfOperations: 5,
      },
      YE_2026,
    )
    expect(r.rcit.format()).toBe('100,000.00') // 20% of 500k
    expect(r.mcit.format()).toBe('200,000.00') // 2% of 10M gross income
    expect(r.incomeTaxDue.format()).toBe('200,000.00')
  })

  it('used the 1% MCIT during the CREATE relief window', () => {
    const r = computeCorporateIncomeTax(
      { ...corpBase, regime: 'rcit', yearsSinceStartOfOperations: 5 },
      '2022-12-31',
    )
    expect(r.mcit.format()).toBe('100,000.00')
  })

  it('ITH pays zero; SCIT pays 5% of gross income in lieu of all taxes', () => {
    expect(
      computeCorporateIncomeTax({ ...corpBase, regime: 'income_tax_holiday' }, YE_2026)
        .incomeTaxDue.isZero(),
    ).toBe(true)
    expect(
      computeCorporateIncomeTax({ ...corpBase, regime: 'special_rate_incentive' }, YE_2026)
        .incomeTaxDue.format(),
    ).toBe('500,000.00')
  })
})
