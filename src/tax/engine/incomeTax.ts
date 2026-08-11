import type { ISODate } from '../../domain/core'
import { Money } from '../../lib/money'
import type { IncomeTaxRegime } from '../../domain/taxProfile'
import { rules } from '../rules'
import { computeBracketTax } from './brackets'

export interface IndividualIncomeTaxInput {
  readonly regime: Extract<
    IncomeTaxRegime,
    'graduated_itemized' | 'graduated_osd' | 'eight_percent' | 'exempt'
  >
  /** Gross sales/receipts from business or profession (net of returns/discounts). */
  readonly grossSalesReceipts: Money
  readonly costOfSales: Money
  readonly itemizedDeductions: Money
  /** Taxable compensation income, when the taxpayer is a mixed-income earner. */
  readonly taxableCompensation: Money
  readonly isMixedIncome: boolean
  /** Non-operating/other taxable income subject to the same schedule. */
  readonly otherTaxableIncome: Money
}

export interface IndividualIncomeTaxResult {
  readonly taxableIncome: Money
  readonly incomeTaxDue: Money
  /** How the business-income side was taxed (for form selection: 1701 vs 1701A). */
  readonly method: 'graduated' | 'eight_percent' | 'exempt'
}

/** Annual income tax for individuals, per the schedule in force for the taxable year. */
export function computeIndividualIncomeTax(
  input: IndividualIncomeTaxInput,
  yearEndDate: ISODate,
): IndividualIncomeTaxResult {
  const table = rules.individualIncomeTax(yearEndDate)

  if (input.regime === 'exempt') {
    return { taxableIncome: Money.ZERO, incomeTaxDue: Money.ZERO, method: 'exempt' }
  }

  if (input.regime === 'eight_percent') {
    // 8% of gross sales/receipts + other income, in lieu of graduated tax and
    // percentage tax. Pure business/professional income deducts ₱250k;
    // mixed-income earners don't (the exemption sits in the compensation
    // brackets already).
    const businessGross = input.grossSalesReceipts.add(input.otherTaxableIncome)
    const exemption = input.isMixedIncome
      ? Money.ZERO
      : Money.fromCentavos(table.eightPercentExemptionCentavos)
    const base = businessGross.subtract(exemption)
    const businessTax = base.isNegative() ? Money.ZERO : base.multiply(table.eightPercentRate)
    const compensationTax = input.isMixedIncome
      ? computeBracketTax(table.brackets, input.taxableCompensation)
      : Money.ZERO
    return {
      taxableIncome: base.isNegative() ? Money.ZERO : base.add(input.taxableCompensation),
      incomeTaxDue: businessTax.add(compensationTax),
      method: 'eight_percent',
    }
  }

  // Graduated: itemized or OSD (40% of gross sales/receipts for individuals).
  const deductions =
    input.regime === 'graduated_osd'
      ? input.grossSalesReceipts.multiply(table.osdRate)
      : input.costOfSales.add(input.itemizedDeductions)
  const businessNet = input.grossSalesReceipts.subtract(deductions)
  const taxableIncome = businessNet
    .add(input.otherTaxableIncome)
    .add(input.isMixedIncome ? input.taxableCompensation : Money.ZERO)
  const clamped = taxableIncome.isNegative() ? Money.ZERO : taxableIncome
  return {
    taxableIncome: clamped,
    incomeTaxDue: computeBracketTax(table.brackets, clamped),
    method: 'graduated',
  }
}

export interface CorporateIncomeTaxInput {
  readonly regime: Extract<
    IncomeTaxRegime,
    'rcit' | 'income_tax_holiday' | 'special_rate_incentive' | 'exempt'
  >
  readonly netTaxableIncome: Money
  /** Gross income (sales − cost of sales) — the MCIT and SCIT base. */
  readonly grossIncome: Money
  /** Total assets excluding land, for the reduced-rate test. */
  readonly totalAssetsExclLand: Money
  /** Taxable year number counted from start of operations (MCIT from year 4). */
  readonly yearsSinceStartOfOperations: number
  readonly isDomestic: boolean
}

export interface CorporateIncomeTaxResult {
  readonly rcit: Money
  readonly mcit: Money
  /** Higher of RCIT and MCIT once MCIT applies; excess MCIT is a carry-forward credit. */
  readonly incomeTaxDue: Money
  readonly mcitApplies: boolean
  readonly appliedRegime: CorporateIncomeTaxInput['regime']
}

export function computeCorporateIncomeTax(
  input: CorporateIncomeTaxInput,
  yearEndDate: ISODate,
): CorporateIncomeTaxResult {
  const table = rules.corporateTax(yearEndDate)

  if (input.regime === 'exempt' || input.regime === 'income_tax_holiday') {
    return {
      rcit: Money.ZERO,
      mcit: Money.ZERO,
      incomeTaxDue: Money.ZERO,
      mcitApplies: false,
      appliedRegime: input.regime,
    }
  }

  if (input.regime === 'special_rate_incentive') {
    // 5% SCIT/GIT in lieu of all national and local taxes, on gross income.
    const tax = input.grossIncome.multiply(table.specialIncentiveRate)
    return {
      rcit: tax,
      mcit: Money.ZERO,
      incomeTaxDue: tax,
      mcitApplies: false,
      appliedRegime: input.regime,
    }
  }

  const qualifiesReduced =
    input.isDomestic &&
    table.rcitReducedRate !== null &&
    table.rcitReducedNetIncomeCapCentavos !== null &&
    table.rcitReducedAssetCapCentavos !== null &&
    input.netTaxableIncome.centavos <= table.rcitReducedNetIncomeCapCentavos &&
    input.totalAssetsExclLand.centavos <= table.rcitReducedAssetCapCentavos

  const rcitRate = qualifiesReduced ? table.rcitReducedRate! : table.rcitStandardRate
  const positiveNet = input.netTaxableIncome.isNegative() ? Money.ZERO : input.netTaxableIncome
  const rcit = positiveNet.multiply(rcitRate)

  const mcitApplies = input.yearsSinceStartOfOperations >= table.mcitStartYear
  const mcit = mcitApplies ? input.grossIncome.multiply(table.mcitRate) : Money.ZERO

  return {
    rcit,
    mcit,
    incomeTaxDue: mcitApplies && mcit.greaterThan(rcit) ? mcit : rcit,
    mcitApplies,
    appliedRegime: 'rcit',
  }
}
