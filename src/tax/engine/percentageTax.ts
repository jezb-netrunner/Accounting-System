import type { ISODate } from '../../domain/core'
import { Money } from '../../lib/money'
import { rules } from '../rules'

/**
 * Percentage tax under Sec. 116 for non-VAT taxpayers: rate × gross
 * quarterly sales/receipts. The rate is date-resolved (3% → 1% during the
 * CREATE relief window → 3%).
 */
export function computePercentageTax(grossReceipts: Money, date: ISODate): Money {
  return grossReceipts.multiply(rules.percentageTax(date).rate)
}
