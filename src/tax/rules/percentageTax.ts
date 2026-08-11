import { pct, type Rate } from '../../lib/money'
import type { EffectivityBlock } from './types'

/** Percentage tax under Sec. 116 (non-VAT taxpayers under the VAT threshold). */
export interface PercentageTaxRuleBlock extends EffectivityBlock {
  readonly rate: Rate
}

export const PERCENTAGE_TAX_RULES: readonly PercentageTaxRuleBlock[] = [
  {
    effectiveFrom: '1998-01-01',
    effectiveTo: '2020-06-30',
    source: 'NIRC Sec. 116',
    rate: pct(3),
  },
  {
    effectiveFrom: '2020-07-01',
    effectiveTo: '2023-06-30',
    source: 'RA 11534 (CREATE) temporary relief',
    rate: pct(1),
  },
  {
    effectiveFrom: '2023-07-01',
    effectiveTo: null,
    source: 'CREATE sunset, reverts to Sec. 116 rate',
    rate: pct(3),
  },
]
