import type { ISODate } from '../../domain/core'
import { Money } from '../../lib/money'
import { rules } from '../rules'
import type { DstRateRule } from '../rules/dst'

export function findDstRule(section: string, date: ISODate): DstRateRule {
  const rule = rules.dst(date).rates.find((r) => r.section === section)
  if (!rule) throw new Error(`No DST rule for ${section} on ${date}`)
  return rule
}

/**
 * DST is "₱X per ₱Y or fractional part thereof" — i.e. units are counted
 * with a ceiling, not rounded. Lease-style rules charge a flat amount on the
 * first slice and per-unit on the excess.
 */
export function computeDst(rule: DstRateRule, base: Money): Money {
  if (rule.flatTaxCentavos !== null && rule.perUnitOfCentavos === 0) {
    return Money.fromCentavos(rule.flatTaxCentavos)
  }
  let remaining = base.centavos
  let tax = 0
  if (rule.flatTaxCentavos !== null && rule.flatCoversFirstCentavos !== null) {
    tax += rule.flatTaxCentavos
    remaining = Math.max(0, remaining - rule.flatCoversFirstCentavos)
  }
  if (remaining > 0) {
    const units = Math.ceil(remaining / rule.perUnitOfCentavos)
    tax += units * rule.taxPerUnitCentavos
  }
  return Money.fromCentavos(tax)
}
