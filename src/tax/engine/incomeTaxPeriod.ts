import type { ISODate } from '../../domain/core'
import { Money } from '../../lib/money'
import {
  isIndividualType,
  type BusinessTaxRegime,
  type EntityType,
} from '../../domain/taxProfile'
import { rules } from '../rules'
import {
  computeCorporateIncomeTax,
  computeIndividualIncomeTax,
  type CorporateIncomeTaxInput,
  type IndividualIncomeTaxInput,
} from './incomeTax'

/**
 * Period-level income tax: the 8% eligibility test, cumulative quarterly
 * returns (1701Q/1702Q are year-to-date less prior payments less creditable
 * withholding), NOLCO vintages with per-vintage expiry, and the excess-MCIT
 * carry-forward credit.
 */

// ---- 8% option eligibility (Sec. 24(A)(2)(b)) ----

export interface EightPercentEligibilityInput {
  readonly entityType: EntityType
  readonly businessTaxRegime: BusinessTaxRegime
  /** Actual or reasonably projected gross sales/receipts for the year. */
  readonly grossSalesReceipts: Money
  readonly date: ISODate
}

export function eightPercentEligibility(
  input: EightPercentEligibilityInput,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!isIndividualType(input.entityType)) {
    reasons.push('Only individuals (sole proprietors, professionals, mixed income) may elect 8%')
  }
  if (input.businessTaxRegime === 'vat') {
    reasons.push('VAT-registered taxpayers cannot elect the 8% option')
  }
  const threshold = rules.thresholds(input.date).vatRegistrationCentavos
  if (input.grossSalesReceipts.centavos > threshold) {
    reasons.push(
      `Gross sales/receipts exceed the ₱${(threshold / 100).toLocaleString()} VAT registration threshold`,
    )
  }
  return { eligible: reasons.length === 0, reasons }
}

// ---- Cumulative quarterly returns ----

export interface IndividualQuarterlyInput {
  readonly regime: IndividualIncomeTaxInput['regime']
  readonly ytdGrossSalesReceipts: Money
  readonly ytdCostOfSales: Money
  readonly ytdItemizedDeductions: Money
  readonly ytdOtherTaxableIncome: Money
  readonly taxableCompensationYtd: Money
  readonly isMixedIncome: boolean
  /** Income tax already paid with this year's earlier quarterly returns. */
  readonly priorQuartersPayments: Money
  /** Creditable withholding (2307s) for the year to date. */
  readonly creditableWithholdingYtd: Money
}

export interface QuarterlyTaxResult {
  readonly taxableIncomeYtd: Money
  readonly taxDueYtd: Money
  /** Negative = overpayment (carried as credit, not refunded quarterly). */
  readonly netPayable: Money
}

/**
 * 1701Q: tax on year-to-date income (so the ₱250k 8% deduction and the
 * graduated brackets apply exactly once a year), less prior quarterly
 * payments, less creditable withholding.
 */
export function computeIndividualQuarterlyTax(
  input: IndividualQuarterlyInput,
  quarterEndDate: ISODate,
): QuarterlyTaxResult {
  const annual = computeIndividualIncomeTax(
    {
      regime: input.regime,
      grossSalesReceipts: input.ytdGrossSalesReceipts,
      costOfSales: input.ytdCostOfSales,
      itemizedDeductions: input.ytdItemizedDeductions,
      taxableCompensation: input.taxableCompensationYtd,
      isMixedIncome: input.isMixedIncome,
      otherTaxableIncome: input.ytdOtherTaxableIncome,
    },
    quarterEndDate,
  )
  return {
    taxableIncomeYtd: annual.taxableIncome,
    taxDueYtd: annual.incomeTaxDue,
    netPayable: annual.incomeTaxDue
      .subtract(input.priorQuartersPayments)
      .subtract(input.creditableWithholdingYtd),
  }
}

export interface CorporateQuarterlyInput {
  readonly regime: CorporateIncomeTaxInput['regime']
  readonly ytdNetTaxableIncome: Money
  readonly ytdGrossIncome: Money
  readonly totalAssetsExclLand: Money
  readonly yearsSinceStartOfOperations: number
  readonly isDomestic: boolean
  readonly priorQuartersPayments: Money
  readonly creditableWithholdingYtd: Money
}

/** 1702Q: RCIT-vs-MCIT on year-to-date figures, less payments and credits. */
export function computeCorporateQuarterlyTax(
  input: CorporateQuarterlyInput,
  quarterEndDate: ISODate,
): QuarterlyTaxResult & { rcit: Money; mcit: Money } {
  const r = computeCorporateIncomeTax(
    {
      regime: input.regime,
      netTaxableIncome: input.ytdNetTaxableIncome,
      grossIncome: input.ytdGrossIncome,
      totalAssetsExclLand: input.totalAssetsExclLand,
      yearsSinceStartOfOperations: input.yearsSinceStartOfOperations,
      isDomestic: input.isDomestic,
    },
    quarterEndDate,
  )
  return {
    taxableIncomeYtd: input.ytdNetTaxableIncome,
    taxDueYtd: r.incomeTaxDue,
    rcit: r.rcit,
    mcit: r.mcit,
    netPayable: r.incomeTaxDue
      .subtract(input.priorQuartersPayments)
      .subtract(input.creditableWithholdingYtd),
  }
}

// ---- NOLCO (Sec. 34(D)(3)) ----

export interface NolcoVintage {
  readonly lossYear: number
  readonly amount: Money
  readonly used: Money
}

const nolcoWindowYears = (lossYear: number, date: ISODate): number => {
  const t = rules.corporateTax(date)
  const extended = t.nolcoExtendedWindows.find(
    (w) => lossYear >= w.lossYearFrom && lossYear <= w.lossYearTo,
  )
  return extended?.carryoverYears ?? t.nolcoCarryoverYears
}

/**
 * Deduct NOLCO FIFO across vintages still inside their carry-over window.
 * A vintage is usable in the N consecutive years *after* the loss year
 * (never the loss year itself) and the deduction never exceeds the income
 * before NOLCO.
 */
export function applyNolco(
  vintages: readonly NolcoVintage[],
  incomeBeforeNolco: Money,
  currentYear: number,
  date: ISODate,
): { deduction: Money; updated: NolcoVintage[] } {
  let room = incomeBeforeNolco.isNegative() ? Money.ZERO : incomeBeforeNolco
  let deduction = Money.ZERO
  const updated = [...vintages]
    .sort((a, b) => a.lossYear - b.lossYear)
    .map((v) => {
      const usable =
        currentYear > v.lossYear && currentYear <= v.lossYear + nolcoWindowYears(v.lossYear, date)
      if (!usable || room.isZero()) return v
      const remaining = v.amount.subtract(v.used)
      if (remaining.isZero() || remaining.isNegative()) return v
      const take = remaining.lessThan(room) ? remaining : room
      room = room.subtract(take)
      deduction = deduction.add(take)
      return { ...v, used: v.used.add(take) }
    })
  return { deduction, updated }
}

// ---- Excess MCIT credit (Sec. 27(E)(2)) ----

export interface McitCredit {
  /** Taxable year the excess MCIT arose. */
  readonly year: number
  readonly amount: Money
  readonly used: Money
}

export interface CorporateAnnualInput {
  readonly regime: CorporateIncomeTaxInput['regime']
  readonly netTaxableIncomeBeforeNolco: Money
  readonly grossIncome: Money
  readonly totalAssetsExclLand: Money
  readonly yearsSinceStartOfOperations: number
  readonly isDomestic: boolean
  readonly taxableYear: number
  readonly nolcoVintages: readonly NolcoVintage[]
  readonly mcitCredits: readonly McitCredit[]
  /** Quarterly payments + creditable withholding for the year. */
  readonly creditsAndPayments: Money
}

export interface CorporateAnnualResult {
  readonly nolcoDeduction: Money
  readonly taxableIncome: Money
  readonly rcit: Money
  readonly mcit: Money
  readonly incomeTaxDue: Money
  readonly mcitApplies: boolean
  /** Excess-MCIT credit applied against this year's RCIT. */
  readonly mcitCreditUsed: Money
  /** New excess arising this year (MCIT > RCIT). */
  readonly newExcessMcit: Money
  readonly newNolcoVintage: NolcoVintage | null
  readonly updatedNolcoVintages: readonly NolcoVintage[]
  readonly updatedMcitCredits: readonly McitCredit[]
  readonly netPayable: Money
}

/**
 * Annual corporate income tax with the carry-forward state machine:
 * NOLCO reduces taxable income first; tax due is the higher of RCIT and
 * MCIT; excess MCIT from prior years offsets RCIT (only in an RCIT year,
 * only within its statutory window); a loss year opens a NOLCO vintage and
 * an MCIT year records a new credit.
 */
export function computeCorporateAnnualTax(
  input: CorporateAnnualInput,
  yearEndDate: ISODate,
): CorporateAnnualResult {
  const t = rules.corporateTax(yearEndDate)

  const { deduction: nolcoDeduction, updated: nolcoAfterUse } = applyNolco(
    input.nolcoVintages,
    input.netTaxableIncomeBeforeNolco,
    input.taxableYear,
    yearEndDate,
  )
  const taxableIncome = input.netTaxableIncomeBeforeNolco.isNegative()
    ? input.netTaxableIncomeBeforeNolco
    : input.netTaxableIncomeBeforeNolco.subtract(nolcoDeduction)

  const core = computeCorporateIncomeTax(
    {
      regime: input.regime,
      netTaxableIncome: taxableIncome,
      grossIncome: input.grossIncome,
      totalAssetsExclLand: input.totalAssetsExclLand,
      yearsSinceStartOfOperations: input.yearsSinceStartOfOperations,
      isDomestic: input.isDomestic,
    },
    yearEndDate,
  )

  const isMcitYear = core.mcitApplies && core.mcit.greaterThan(core.rcit)

  // Excess MCIT is creditable only against RCIT, in the N years after it arose.
  let mcitCreditUsed = Money.ZERO
  let creditRoom = isMcitYear ? Money.ZERO : core.rcit
  const creditsAfterUse = [...input.mcitCredits]
    .sort((a, b) => a.year - b.year)
    .map((c) => {
      const usable =
        input.taxableYear > c.year && input.taxableYear <= c.year + t.mcitExcessCarryoverYears
      if (!usable || creditRoom.isZero()) return c
      const remaining = c.amount.subtract(c.used)
      if (remaining.isZero() || remaining.isNegative()) return c
      const take = remaining.lessThan(creditRoom) ? remaining : creditRoom
      creditRoom = creditRoom.subtract(take)
      mcitCreditUsed = mcitCreditUsed.add(take)
      return { ...c, used: c.used.add(take) }
    })

  const newExcessMcit = isMcitYear ? core.mcit.subtract(core.rcit) : Money.ZERO
  const updatedMcitCredits = newExcessMcit.isZero()
    ? creditsAfterUse
    : [...creditsAfterUse, { year: input.taxableYear, amount: newExcessMcit, used: Money.ZERO }]

  const newNolcoVintage: NolcoVintage | null = input.netTaxableIncomeBeforeNolco.isNegative()
    ? {
        lossYear: input.taxableYear,
        amount: input.netTaxableIncomeBeforeNolco.negate(),
        used: Money.ZERO,
      }
    : null
  const updatedNolcoVintages = newNolcoVintage
    ? [...nolcoAfterUse, newNolcoVintage]
    : nolcoAfterUse

  return {
    nolcoDeduction,
    taxableIncome,
    rcit: core.rcit,
    mcit: core.mcit,
    incomeTaxDue: core.incomeTaxDue,
    mcitApplies: core.mcitApplies,
    mcitCreditUsed,
    newExcessMcit,
    newNolcoVintage,
    updatedNolcoVintages,
    updatedMcitCredits,
    netPayable: core.incomeTaxDue.subtract(mcitCreditUsed).subtract(input.creditsAndPayments),
  }
}
