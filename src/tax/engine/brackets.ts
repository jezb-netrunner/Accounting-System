import { Money } from '../../lib/money'
import type { TaxBracket } from '../rules/types'

/** Progressive tax: base tax of the bracket + marginal rate on the excess. */
export function computeBracketTax(brackets: readonly TaxBracket[], taxable: Money): Money {
  if (taxable.centavos <= 0) return Money.ZERO
  const bracket = brackets.find(
    (b) =>
      taxable.centavos > b.overCentavos &&
      (b.upToCentavos === null || taxable.centavos <= b.upToCentavos),
  )
  if (!bracket) throw new Error(`No bracket covers ${taxable.format()}`)
  const excess = taxable.subtract(Money.fromCentavos(bracket.overCentavos))
  return Money.fromCentavos(bracket.baseTaxCentavos).add(excess.multiply(bracket.marginalRate))
}
