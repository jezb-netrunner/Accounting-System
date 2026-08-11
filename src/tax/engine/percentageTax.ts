import type { ISODate } from '../../domain/core'
import type { AccountingBasis } from '../../domain/taxProfile'
import { Money, type Rate } from '../../lib/money'
import { rules } from '../rules'

/**
 * Percentage tax under Sec. 116 for non-VAT taxpayers: rate × gross
 * quarterly sales/receipts. The rate is date-resolved (3% → 1% during the
 * CREATE relief window → 3%).
 */
export function computePercentageTax(grossReceipts: Money, date: ISODate): Money {
  return grossReceipts.multiply(rules.percentageTax(date).rate)
}

export interface PercentageTaxQuarterInput {
  readonly basis: AccountingBasis
  /** Invoiced gross sales for the quarter (accrual base). */
  readonly accruedGrossSales: Money
  /** Amounts actually collected in the quarter (cash base). */
  readonly cashCollections: Money
}

/**
 * 2551Q figure: the taxable base follows the company's accounting basis —
 * invoiced sales on accrual, collections on cash — at the rate in force on
 * the quarter-end date.
 */
export function computePercentageTaxQuarter(
  input: PercentageTaxQuarterInput,
  quarterEndDate: ISODate,
): { base: Money; rate: Rate; tax: Money } {
  const base = input.basis === 'cash' ? input.cashCollections : input.accruedGrossSales
  const rate = rules.percentageTax(quarterEndDate).rate
  return { base, rate, tax: base.multiply(rate) }
}
