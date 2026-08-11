import { dateInRange, type ISODate } from '../../domain/core'
import type { Rate } from '../../lib/money'

/**
 * Every rule table is an array of effectivity blocks. The engine resolves the
 * block covering a transaction date, so historical periods compute with the
 * rules in force at the time. `effectiveTo: null` = currently in force.
 */
export interface EffectivityBlock {
  readonly effectiveFrom: ISODate
  readonly effectiveTo: ISODate | null
  /** Statute / issuance the block implements, for audit trail (e.g. "RA 10963 (TRAIN)"). */
  readonly source: string
}

export class RuleNotFoundError extends Error {
  constructor(table: string, date: ISODate) {
    super(`No ${table} rule block covers ${date}. Add an effectivity block in src/tax/rules/.`)
  }
}

/** Resolve the block in force on `date`. Throws if the table has a gap. */
export function resolveEffective<T extends EffectivityBlock>(
  table: readonly T[],
  date: ISODate,
  tableName: string,
): T {
  const hit = table.find((b) => dateInRange(date, b.effectiveFrom, b.effectiveTo))
  if (!hit) throw new RuleNotFoundError(tableName, date)
  return hit
}

/** A progressive bracket: tax = base + rate × (amount − over), for over ≤ amount < upTo. */
export interface TaxBracket {
  /** Lower bound, exclusive floor of the bracket, in centavos. */
  readonly overCentavos: number
  /** Upper bound in centavos; null = no ceiling. */
  readonly upToCentavos: number | null
  /** Fixed tax on the lower bound, in centavos. */
  readonly baseTaxCentavos: number
  /** Marginal rate applied to the excess over the lower bound. */
  readonly marginalRate: Rate
}
