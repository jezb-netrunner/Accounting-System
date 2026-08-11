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

/** Payroll frequencies the BIR revised withholding tax table publishes columns for. */
export type PayFrequency = 'daily' | 'weekly' | 'semi_monthly' | 'monthly'

/** Withholding tax on compensation — annualized table mirrors Sec. 24(A). */
export interface CompensationWithholdingRuleBlock extends EffectivityBlock {
  /** Monthly payroll table (BIR revised withholding tax table). */
  readonly monthlyBrackets: readonly TaxBracket[]
  /** Full per-frequency tables; `monthly` is the same array as monthlyBrackets. */
  readonly bracketsByFrequency: Readonly<Record<PayFrequency, readonly TaxBracket[]>>
  /** Annual cap on tax-exempt 13th month pay & other benefits. */
  readonly thirteenthMonthExclusionCentavos: number
  /** Statutory contributions (SSS/PhilHealth/Pag-IBIG) are excluded from the base. */
  readonly deMinimisNote: string
}

const MONTHLY_2018: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(20_833), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(20_833), upToCentavos: P(33_333), baseTaxCentavos: 0, marginalRate: pct(20) },
  { overCentavos: P(33_333), upToCentavos: P(66_667), baseTaxCentavos: P(2_500), marginalRate: pct(25) },
  { overCentavos: P(66_667), upToCentavos: P(166_667), baseTaxCentavos: P(10_833) + 33, marginalRate: pct(30) },
  { overCentavos: P(166_667), upToCentavos: P(666_667), baseTaxCentavos: P(40_833) + 33, marginalRate: pct(32) },
  { overCentavos: P(666_667), upToCentavos: null, baseTaxCentavos: P(200_833) + 33, marginalRate: pct(35) },
]

// TODO: verify — semi-monthly/weekly/daily 2018-2022 columns transcribed from
// the RR 8-2018 revised withholding tax table; confirm against the BIR annex.
const SEMI_MONTHLY_2018: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(10_417), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(10_417), upToCentavos: P(16_667), baseTaxCentavos: 0, marginalRate: pct(20) },
  { overCentavos: P(16_667), upToCentavos: P(33_333), baseTaxCentavos: P(1_250), marginalRate: pct(25) },
  { overCentavos: P(33_333), upToCentavos: P(83_333), baseTaxCentavos: P(5_416) + 67, marginalRate: pct(30) },
  { overCentavos: P(83_333), upToCentavos: P(333_333), baseTaxCentavos: P(20_416) + 67, marginalRate: pct(32) },
  { overCentavos: P(333_333), upToCentavos: null, baseTaxCentavos: P(100_416) + 67, marginalRate: pct(35) },
]

// TODO: verify — see SEMI_MONTHLY_2018 note.
const WEEKLY_2018: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(4_808), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(4_808), upToCentavos: P(7_692), baseTaxCentavos: 0, marginalRate: pct(20) },
  { overCentavos: P(7_692), upToCentavos: P(15_385), baseTaxCentavos: P(576) + 92, marginalRate: pct(25) },
  { overCentavos: P(15_385), upToCentavos: P(38_462), baseTaxCentavos: P(2_500), marginalRate: pct(30) },
  { overCentavos: P(38_462), upToCentavos: P(153_846), baseTaxCentavos: P(9_423) + 8, marginalRate: pct(32) },
  { overCentavos: P(153_846), upToCentavos: null, baseTaxCentavos: P(46_346) + 15, marginalRate: pct(35) },
]

// TODO: verify — see SEMI_MONTHLY_2018 note.
const DAILY_2018: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(685), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(685), upToCentavos: P(1_096), baseTaxCentavos: 0, marginalRate: pct(20) },
  { overCentavos: P(1_096), upToCentavos: P(2_192), baseTaxCentavos: P(82) + 19, marginalRate: pct(25) },
  { overCentavos: P(2_192), upToCentavos: P(5_479), baseTaxCentavos: P(356) + 16, marginalRate: pct(30) },
  { overCentavos: P(5_479), upToCentavos: P(21_918), baseTaxCentavos: P(1_342) + 47, marginalRate: pct(32) },
  { overCentavos: P(21_918), upToCentavos: null, baseTaxCentavos: P(6_602) + 74, marginalRate: pct(35) },
]

const MONTHLY_2023: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(20_833), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(20_833), upToCentavos: P(33_333), baseTaxCentavos: 0, marginalRate: pct(15) },
  { overCentavos: P(33_333), upToCentavos: P(66_667), baseTaxCentavos: P(1_875), marginalRate: pct(20) },
  { overCentavos: P(66_667), upToCentavos: P(166_667), baseTaxCentavos: P(8_541) + 80, marginalRate: pct(25) },
  { overCentavos: P(166_667), upToCentavos: P(666_667), baseTaxCentavos: P(33_541) + 80, marginalRate: pct(30) },
  { overCentavos: P(666_667), upToCentavos: null, baseTaxCentavos: P(183_541) + 80, marginalRate: pct(35) },
]

// TODO: verify — semi-monthly/weekly/daily 2023+ columns transcribed from the
// revised withholding tax table effective 2023-01-01; confirm against the BIR annex.
const SEMI_MONTHLY_2023: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(10_417), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(10_417), upToCentavos: P(16_667), baseTaxCentavos: 0, marginalRate: pct(15) },
  { overCentavos: P(16_667), upToCentavos: P(33_333), baseTaxCentavos: P(937) + 50, marginalRate: pct(20) },
  { overCentavos: P(33_333), upToCentavos: P(83_333), baseTaxCentavos: P(4_270) + 70, marginalRate: pct(25) },
  { overCentavos: P(83_333), upToCentavos: P(333_333), baseTaxCentavos: P(16_770) + 70, marginalRate: pct(30) },
  { overCentavos: P(333_333), upToCentavos: null, baseTaxCentavos: P(91_770) + 70, marginalRate: pct(35) },
]

// TODO: verify — see SEMI_MONTHLY_2023 note.
const WEEKLY_2023: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(4_808), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(4_808), upToCentavos: P(7_692), baseTaxCentavos: 0, marginalRate: pct(15) },
  { overCentavos: P(7_692), upToCentavos: P(15_385), baseTaxCentavos: P(432) + 60, marginalRate: pct(20) },
  { overCentavos: P(15_385), upToCentavos: P(38_462), baseTaxCentavos: P(1_971) + 20, marginalRate: pct(25) },
  { overCentavos: P(38_462), upToCentavos: P(153_846), baseTaxCentavos: P(7_740) + 45, marginalRate: pct(30) },
  { overCentavos: P(153_846), upToCentavos: null, baseTaxCentavos: P(42_355) + 65, marginalRate: pct(35) },
]

// TODO: verify — see SEMI_MONTHLY_2023 note.
const DAILY_2023: readonly TaxBracket[] = [
  { overCentavos: 0, upToCentavos: P(685), baseTaxCentavos: 0, marginalRate: pct(0) },
  { overCentavos: P(685), upToCentavos: P(1_096), baseTaxCentavos: 0, marginalRate: pct(15) },
  { overCentavos: P(1_096), upToCentavos: P(2_192), baseTaxCentavos: P(61) + 65, marginalRate: pct(20) },
  { overCentavos: P(2_192), upToCentavos: P(5_479), baseTaxCentavos: P(280) + 85, marginalRate: pct(25) },
  { overCentavos: P(5_479), upToCentavos: P(21_918), baseTaxCentavos: P(1_102) + 60, marginalRate: pct(30) },
  { overCentavos: P(21_918), upToCentavos: null, baseTaxCentavos: P(6_034) + 30, marginalRate: pct(35) },
]

export const COMPENSATION_WITHHOLDING_RULES: readonly CompensationWithholdingRuleBlock[] = [
  {
    effectiveFrom: '2018-01-01',
    effectiveTo: '2022-12-31',
    source: 'RR 8-2018 revised withholding table (2018-2022)',
    monthlyBrackets: MONTHLY_2018,
    bracketsByFrequency: {
      daily: DAILY_2018,
      weekly: WEEKLY_2018,
      semi_monthly: SEMI_MONTHLY_2018,
      monthly: MONTHLY_2018,
    },
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimisNote: 'Base excludes mandatory SSS/PhilHealth/Pag-IBIG contributions and de minimis within caps',
  },
  {
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    source: 'RR 11-2018 Annex, 2023-onward withholding table',
    monthlyBrackets: MONTHLY_2023,
    bracketsByFrequency: {
      daily: DAILY_2023,
      weekly: WEEKLY_2023,
      semi_monthly: SEMI_MONTHLY_2023,
      monthly: MONTHLY_2023,
    },
    thirteenthMonthExclusionCentavos: P(90_000),
    deMinimisNote: 'Base excludes mandatory SSS/PhilHealth/Pag-IBIG contributions and de minimis within caps',
  },
]
