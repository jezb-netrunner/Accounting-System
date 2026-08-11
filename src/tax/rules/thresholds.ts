import { pct, type Rate } from '../../lib/money'
import type { EffectivityBlock } from './types'

/**
 * Peso thresholds and named limits. Configurable data, never literals in the
 * engine: EOPT (RA 11976) makes several of these subject to periodic
 * adjustment, so new values arrive as new effectivity blocks.
 */
export interface ThresholdRuleBlock extends EffectivityBlock {
  /** VAT registration threshold (12-month gross sales). Also caps the 8% option. */
  readonly vatRegistrationCentavos: number
  /** EOPT taxpayer classification bounds (RA 11976): micro < small < medium < large. */
  readonly eoptSmallFloorCentavos: number
  readonly eoptMediumFloorCentavos: number
  readonly eoptLargeFloorCentavos: number
  /** Fringe benefits tax rate and gross-up divisor. */
  readonly fbtRate: Rate
  readonly fbtGrossUpDivisor: Rate
  /** Annual ₱ cap on tax-exempt 13th month & other benefits. */
  readonly thirteenthMonthExclusionCentavos: number
  /** De minimis caps (annual unless noted); representative, extensible set. */
  readonly deMinimis: Readonly<Record<string, number>>
  /**
   * EOPT document rules: from 2024 the invoice is the single document for
   * goods AND services (sales invoice replaces official receipt for VAT
   * purposes); services recognize output tax on invoice, not collection.
   */
  readonly invoiceBasedRecognitionForServices: boolean
  /** ₱500 annual registration fee (form 0605) — abolished by EOPT; null = no fee. */
  readonly annualRegistrationFeeCentavos: number | null
}

const P = (pesos: number) => pesos * 100

export const THRESHOLD_RULES: readonly ThresholdRuleBlock[] = [
  {
    effectiveFrom: '2018-01-01',
    effectiveTo: '2023-12-31',
    source: 'RA 10963 (TRAIN): ₱3M VAT threshold; receipt basis for services',
    vatRegistrationCentavos: P(3_000_000),
    // Pre-EOPT there was no statutory micro/small/medium/large classification;
    // carry the later bounds so lookups never gap.
    eoptSmallFloorCentavos: P(3_000_000),
    eoptMediumFloorCentavos: P(20_000_000),
    eoptLargeFloorCentavos: P(1_000_000_000),
    fbtRate: pct(35),
    fbtGrossUpDivisor: pct(65),
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimis: {
      rice_subsidy_monthly: P(2_000),
      uniform_allowance_annual: P(6_000),
      medical_cash_allowance_semestral: P(1_500),
      laundry_allowance_monthly: P(300),
      achievement_award_annual: P(10_000),
      gifts_annual: P(5_000),
    },
    invoiceBasedRecognitionForServices: false,
    annualRegistrationFeeCentavos: P(500),
  },
  {
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    source: 'RA 11976 (EOPT) + RR 3-2024/RR 8-2024: invoice-based VAT on services, taxpayer classification',
    vatRegistrationCentavos: P(3_000_000),
    eoptSmallFloorCentavos: P(3_000_000),
    eoptMediumFloorCentavos: P(20_000_000),
    eoptLargeFloorCentavos: P(1_000_000_000),
    fbtRate: pct(35),
    fbtGrossUpDivisor: pct(65),
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimis: {
      rice_subsidy_monthly: P(2_000),
      uniform_allowance_annual: P(6_000),
      medical_cash_allowance_semestral: P(1_500),
      laundry_allowance_monthly: P(300),
      achievement_award_annual: P(10_000),
      gifts_annual: P(5_000),
    },
    invoiceBasedRecognitionForServices: true,
    annualRegistrationFeeCentavos: null,
  },
]
