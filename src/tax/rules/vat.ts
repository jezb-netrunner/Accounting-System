import { pct, type Rate } from '../../lib/money'
import type { EffectivityBlock } from './types'

export interface VatRuleBlock extends EffectivityBlock {
  readonly standardRate: Rate
  readonly zeroRate: Rate
  /** Final VAT withheld on sales to government (creditable from 2021 per CREATE). */
  readonly governmentWithholdingRate: Rate
}

export const VAT_RULES: readonly VatRuleBlock[] = [
  {
    effectiveFrom: '1988-01-01',
    effectiveTo: '2006-01-31',
    source: 'EO 273 (original VAT law)',
    standardRate: pct(10),
    zeroRate: pct(0),
    governmentWithholdingRate: pct(5),
  },
  {
    effectiveFrom: '2006-02-01',
    effectiveTo: null,
    source: 'RA 9337 (RVAT), rate raised to 12%',
    standardRate: pct(12),
    zeroRate: pct(0),
    governmentWithholdingRate: pct(5),
  },
]
