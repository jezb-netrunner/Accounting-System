import type { Rate } from '../../lib/money'
import { rate } from '../../lib/money'
import type { EffectivityBlock } from './types'

/**
 * Documentary stamp tax. DST is mostly "₱X per ₱Y (or fraction thereof) of
 * consideration/face value", so each entry carries a unit tax and unit base
 * rather than a plain percentage.
 */
export interface DstRateRule {
  /** NIRC section, e.g. "Sec. 174". */
  readonly section: string
  readonly documentType: string
  /** Tax per unit, in centavos. */
  readonly taxPerUnitCentavos: number
  /** Unit of base value, in centavos ("per ₱200" → 20000). */
  readonly perUnitOfCentavos: number
  /** Fixed-amount documents (e.g. ₱30 flat) set both above to 0 and use this. */
  readonly flatTaxCentavos: number | null
  /** When set, flatTax covers the first ₱N of base; per-unit tax applies to the excess (lease-style). */
  readonly flatCoversFirstCentavos: number | null
  /** Effective proportional rate for display, when meaningful. */
  readonly approximateRate: Rate | null
}

export interface DstRuleBlock extends EffectivityBlock {
  readonly rates: readonly DstRateRule[]
}

const P = (pesos: number) => pesos * 100

export const DST_RULES: readonly DstRuleBlock[] = [
  {
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    source: 'RA 10963 (TRAIN) Title VII — most DST rates doubled',
    rates: [
      { section: 'Sec. 174', documentType: 'Original issue of shares', taxPerUnitCentavos: P(2), perUnitOfCentavos: P(200), flatTaxCentavos: null, flatCoversFirstCentavos: null, approximateRate: rate(1, 100) },
      { section: 'Sec. 175', documentType: 'Sales/transfer of shares', taxPerUnitCentavos: 150, perUnitOfCentavos: P(200), flatTaxCentavos: null, flatCoversFirstCentavos: null, approximateRate: rate(75, 10_000) },
      { section: 'Sec. 179', documentType: 'Debt instruments / loan agreements', taxPerUnitCentavos: 150, perUnitOfCentavos: P(200), flatTaxCentavos: null, flatCoversFirstCentavos: null, approximateRate: rate(75, 10_000) },
      { section: 'Sec. 194', documentType: 'Lease of real property (first ₱2,000 + per ₱1,000 thereafter)', taxPerUnitCentavos: P(2), perUnitOfCentavos: P(1_000), flatTaxCentavos: P(6), flatCoversFirstCentavos: P(2_000), approximateRate: null },
      { section: 'Sec. 196', documentType: 'Deed of sale of real property', taxPerUnitCentavos: P(15), perUnitOfCentavos: P(1_000), flatTaxCentavos: null, flatCoversFirstCentavos: null, approximateRate: rate(15, 1_000) },
      { section: 'Sec. 188', documentType: 'Certificates (notarial, etc.)', taxPerUnitCentavos: 0, perUnitOfCentavos: 0, flatTaxCentavos: P(30), flatCoversFirstCentavos: null, approximateRate: null },
    ],
  },
]
