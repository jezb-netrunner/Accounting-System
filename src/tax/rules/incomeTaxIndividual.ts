import { pct } from '../../lib/money'
import type { EffectivityBlock, TaxBracket } from './types'

/** Graduated income tax on individuals (NIRC Sec. 24(A), as amended by TRAIN). */
export interface IndividualIncomeTaxRuleBlock extends EffectivityBlock {
  readonly brackets: readonly TaxBracket[]
  /**
   * 8% option: rate and the annual amount deducted from gross before applying
   * it (₱250,000 for pure business/professional income; not available to
   * mixed-income earners' business income — the engine handles that flag).
   */
  readonly eightPercentRate: TaxBracket['marginalRate']
  readonly eightPercentExemptionCentavos: number
  /** OSD percentage of gross sales/receipts for individuals. */
  readonly osdRate: TaxBracket['marginalRate']
}

const P = (pesos: number) => pesos * 100

export const INDIVIDUAL_INCOME_TAX_RULES: readonly IndividualIncomeTaxRuleBlock[] = [
  {
    effectiveFrom: '2018-01-01',
    effectiveTo: '2022-12-31',
    source: 'RA 10963 (TRAIN) Sec. 24(A)(2)(a), 2018-2022 schedule',
    brackets: [
      { overCentavos: 0, upToCentavos: P(250_000), baseTaxCentavos: 0, marginalRate: pct(0) },
      { overCentavos: P(250_000), upToCentavos: P(400_000), baseTaxCentavos: 0, marginalRate: pct(20) },
      { overCentavos: P(400_000), upToCentavos: P(800_000), baseTaxCentavos: P(30_000), marginalRate: pct(25) },
      { overCentavos: P(800_000), upToCentavos: P(2_000_000), baseTaxCentavos: P(130_000), marginalRate: pct(30) },
      { overCentavos: P(2_000_000), upToCentavos: P(8_000_000), baseTaxCentavos: P(490_000), marginalRate: pct(32) },
      { overCentavos: P(8_000_000), upToCentavos: null, baseTaxCentavos: P(2_410_000), marginalRate: pct(35) },
    ],
    eightPercentRate: pct(8),
    eightPercentExemptionCentavos: P(250_000),
    osdRate: pct(40),
  },
  {
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    source: 'RA 10963 (TRAIN) Sec. 24(A)(2)(a), 2023-onward schedule',
    brackets: [
      { overCentavos: 0, upToCentavos: P(250_000), baseTaxCentavos: 0, marginalRate: pct(0) },
      { overCentavos: P(250_000), upToCentavos: P(400_000), baseTaxCentavos: 0, marginalRate: pct(15) },
      { overCentavos: P(400_000), upToCentavos: P(800_000), baseTaxCentavos: P(22_500), marginalRate: pct(20) },
      { overCentavos: P(800_000), upToCentavos: P(2_000_000), baseTaxCentavos: P(102_500), marginalRate: pct(25) },
      { overCentavos: P(2_000_000), upToCentavos: P(8_000_000), baseTaxCentavos: P(402_500), marginalRate: pct(30) },
      { overCentavos: P(8_000_000), upToCentavos: null, baseTaxCentavos: P(2_202_500), marginalRate: pct(35) },
    ],
    eightPercentRate: pct(8),
    eightPercentExemptionCentavos: P(250_000),
    osdRate: pct(40),
  },
]
