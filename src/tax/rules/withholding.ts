import { pct, type Rate } from '../../lib/money'
import type { EffectivityBlock, TaxBracket } from './types'

/**
 * ATC (Alphanumeric Tax Code) rate matrix: expanded/creditable and final
 * withholding, keyed by nature of payment and payee class.
 *
 * This is seed data, deliberately not exhaustive — the full BIR ATC list runs
 * to hundreds of codes. Add rows here (or via master-data import) following
 * the same shape; the engine only ever looks rates up, never hardcodes them.
 */

export type PayeeClass = 'individual' | 'corporation'
export type WithholdingKind = 'expanded' | 'final'

export interface AtcRateRule {
  readonly atc: string
  readonly kind: WithholdingKind
  readonly payeeClass: PayeeClass
  readonly natureOfPayment: string
  readonly rate: Rate
  /**
   * Some ATCs have a rate that steps up past an annual gross threshold
   * (e.g. professional fees: 5% up to ₱3M gross, 10% beyond; corporate
   * professional services 10%/15% at ₱720k). Null = flat rate.
   */
  readonly higherRate: Rate | null
  readonly higherRateThresholdCentavos: number | null
}

export interface WithholdingRuleBlock extends EffectivityBlock {
  readonly atcRates: readonly AtcRateRule[]
}

const P = (pesos: number) => pesos * 100

export const WITHHOLDING_RULES: readonly WithholdingRuleBlock[] = [
  {
    effectiveFrom: '2019-01-01',
    effectiveTo: null,
    source: 'RR 11-2018 as amended (TRAIN-era EWT/FWT matrix)',
    atcRates: [
      // ---- Expanded / creditable ----
      { atc: 'WI010', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Professional fees / talent fees', rate: pct(5), higherRate: pct(10), higherRateThresholdCentavos: P(3_000_000) },
      { atc: 'WC010', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Professional services (juridical)', rate: pct(10), higherRate: pct(15), higherRateThresholdCentavos: P(720_000) },
      { atc: 'WI100', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Rental of real/personal property', rate: pct(5), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC100', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Rental of real/personal property', rate: pct(5), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI120', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Contractors (general engineering, labor, services)', rate: pct(2), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC120', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Contractors (general engineering, labor, services)', rate: pct(2), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI158', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Purchase of goods (by Top Withholding Agent)', rate: pct(1), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC158', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Purchase of goods (by Top Withholding Agent)', rate: pct(1), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI160', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Purchase of services (by Top Withholding Agent)', rate: pct(2), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC160', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Purchase of services (by Top Withholding Agent)', rate: pct(2), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI139', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Commission of independent sales agents', rate: pct(10), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC139', kind: 'expanded', payeeClass: 'corporation', natureOfPayment: 'Commission (juridical agents)', rate: pct(10), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI070', kind: 'expanded', payeeClass: 'individual', natureOfPayment: 'Income distribution to beneficiaries / GPP partners', rate: pct(10), higherRate: pct(15), higherRateThresholdCentavos: P(720_000) },
      // ---- Final ----
      { atc: 'WI202', kind: 'final', payeeClass: 'individual', natureOfPayment: 'Cash/property dividends to citizens & residents', rate: pct(10), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WC212', kind: 'final', payeeClass: 'corporation', natureOfPayment: 'Interest on foreign loans', rate: pct(20), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI170', kind: 'final', payeeClass: 'individual', natureOfPayment: 'Interest on peso bank deposits', rate: pct(20), higherRate: null, higherRateThresholdCentavos: null },
      { atc: 'WI180', kind: 'final', payeeClass: 'individual', natureOfPayment: 'Royalties (general)', rate: pct(20), higherRate: null, higherRateThresholdCentavos: null },
    ],
  },
]

/** Withholding tax on compensation — annualized table mirrors Sec. 24(A). */
export interface CompensationWithholdingRuleBlock extends EffectivityBlock {
  /** Monthly payroll table (BIR revised withholding tax table). */
  readonly monthlyBrackets: readonly TaxBracket[]
  /** Annual cap on tax-exempt 13th month pay & other benefits. */
  readonly thirteenthMonthExclusionCentavos: number
  /** Statutory contributions (SSS/PhilHealth/Pag-IBIG) are excluded from the base. */
  readonly deMinimisNote: string
}

export const COMPENSATION_WITHHOLDING_RULES: readonly CompensationWithholdingRuleBlock[] = [
  {
    effectiveFrom: '2018-01-01',
    effectiveTo: '2022-12-31',
    source: 'RR 8-2018 revised withholding table (2018-2022)',
    monthlyBrackets: [
      { overCentavos: 0, upToCentavos: P(20_833), baseTaxCentavos: 0, marginalRate: pct(0) },
      { overCentavos: P(20_833), upToCentavos: P(33_333), baseTaxCentavos: 0, marginalRate: pct(20) },
      { overCentavos: P(33_333), upToCentavos: P(66_667), baseTaxCentavos: P(2_500), marginalRate: pct(25) },
      { overCentavos: P(66_667), upToCentavos: P(166_667), baseTaxCentavos: P(10_833) + 33, marginalRate: pct(30) },
      { overCentavos: P(166_667), upToCentavos: P(666_667), baseTaxCentavos: P(40_833) + 33, marginalRate: pct(32) },
      { overCentavos: P(666_667), upToCentavos: null, baseTaxCentavos: P(200_833) + 33, marginalRate: pct(35) },
    ],
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimisNote: 'Base excludes mandatory SSS/PhilHealth/Pag-IBIG contributions and de minimis within caps',
  },
  {
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    source: 'RR 11-2018 Annex, 2023-onward monthly withholding table',
    monthlyBrackets: [
      { overCentavos: 0, upToCentavos: P(20_833), baseTaxCentavos: 0, marginalRate: pct(0) },
      { overCentavos: P(20_833), upToCentavos: P(33_333), baseTaxCentavos: 0, marginalRate: pct(15) },
      { overCentavos: P(33_333), upToCentavos: P(66_667), baseTaxCentavos: P(1_875), marginalRate: pct(20) },
      { overCentavos: P(66_667), upToCentavos: P(166_667), baseTaxCentavos: P(8_541) + 80, marginalRate: pct(25) },
      { overCentavos: P(166_667), upToCentavos: P(666_667), baseTaxCentavos: P(33_541) + 80, marginalRate: pct(30) },
      { overCentavos: P(666_667), upToCentavos: null, baseTaxCentavos: P(183_541) + 80, marginalRate: pct(35) },
    ],
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimisNote: 'Base excludes mandatory SSS/PhilHealth/Pag-IBIG contributions and de minimis within caps',
  },
]
