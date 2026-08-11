import type { ISODate } from '../../domain/core'
import { Money } from '../../lib/money'
import { rules } from '../rules'
import { computeBracketTax } from './brackets'

export interface WithholdingResult {
  readonly atc: string
  readonly kind: 'expanded' | 'final'
  /** The base the rate was applied to (VAT-exclusive income payment). */
  readonly base: Money
  readonly amount: Money
  /** True when the higher tier of a two-tier ATC applied. */
  readonly higherTierApplied: boolean
}

/**
 * Withholding = ATC rate × base. The base is the income payment excluding
 * VAT. Two-tier ATCs (professional fees 5%/10%, corporate professional
 * services 10%/15%) step up when the payee's cumulative gross for the year
 * crosses the threshold — pass `cumulativeAnnualGross` (before this payment)
 * to get the stepping; omit it to stay on the declared tier. Company-defined
 * ATC master data rows arrive via `extraRates` (the built-in table wins on
 * conflicts).
 */
export function computeWithholding(
  atc: string,
  base: Money,
  date: ISODate,
  options: {
    cumulativeAnnualGross?: Money
    payeeDeclaredHigherTier?: boolean
    extraRates?: readonly import('../rules/withholding').AtcRateRule[]
  } = {},
): WithholdingResult {
  const rule = rules.atc(date, atc) ?? options.extraRates?.find((r) => r.atc === atc)
  if (!rule) throw new Error(`Unknown ATC "${atc}" for ${date} — add it to the withholding rules table`)

  let higherTierApplied = false
  let appliedRate = rule.rate
  if (rule.higherRate && rule.higherRateThresholdCentavos !== null) {
    const cumulative = (options.cumulativeAnnualGross ?? Money.ZERO).add(base)
    if (options.payeeDeclaredHigherTier || cumulative.centavos > rule.higherRateThresholdCentavos) {
      appliedRate = rule.higherRate
      higherTierApplied = true
    }
  }
  return { atc, kind: rule.kind, base, amount: base.multiply(appliedRate), higherTierApplied }
}

/**
 * Withholding tax on compensation for one monthly payroll run, using the
 * BIR revised withholding table in force on the payroll date. `taxable` is
 * monthly compensation net of mandatory contributions and de-minimis within
 * caps (payroll computes that; this applies the table).
 */
export function computeCompensationWithholding(taxableMonthly: Money, date: ISODate): Money {
  const table = rules.compensationWithholding(date)
  return computeBracketTax(table.monthlyBrackets, taxableMonthly)
}

/** Fringe benefits tax: grossed-up monetary value × FBT rate. */
export function computeFringeBenefitsTax(
  monetaryValue: Money,
  date: ISODate,
): { grossedUpValue: Money; tax: Money } {
  const t = rules.thresholds(date)
  // Grossed-up value = monetary value ÷ gross-up divisor (65% under TRAIN),
  // i.e. multiply by the divisor's reciprocal.
  const grossedUpValue = monetaryValue.multiply({
    num: t.fbtGrossUpDivisor.den,
    den: t.fbtGrossUpDivisor.num,
  })
  return { grossedUpValue, tax: grossedUpValue.multiply(t.fbtRate) }
}
