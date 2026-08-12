import { pct, type Rate } from '../../lib/money'
import type { EffectivityBlock } from './types'

/** Corporate income tax (RCIT), MCIT, OSD, and incentive rates. */
export interface CorporateTaxRuleBlock extends EffectivityBlock {
  readonly rcitStandardRate: Rate
  /**
   * Reduced RCIT for domestic corporations under both thresholds below
   * (CREATE: 20% when net taxable income ≤ ₱5M and total assets ≤ ₱100M
   * excluding land). Null when no reduced tier exists.
   */
  readonly rcitReducedRate: Rate | null
  readonly rcitReducedNetIncomeCapCentavos: number | null
  readonly rcitReducedAssetCapCentavos: number | null
  readonly mcitRate: Rate
  /** MCIT applies beginning this taxable year counted from start of operations. */
  readonly mcitStartYear: number
  /** OSD percentage of gross income for corporations. */
  readonly osdRate: Rate
  /** Special corporate income tax (incentives, e.g. 5% SCIT in lieu of all taxes). */
  readonly specialIncentiveRate: Rate
  /** NOLCO: net operating loss deductible in the N consecutive years after the loss year. */
  readonly nolcoCarryoverYears: number
  /** Loss years with an extended NOLCO window (Bayanihan II: 2020-2021 losses get 5 years). */
  readonly nolcoExtendedWindows: readonly {
    readonly lossYearFrom: number
    readonly lossYearTo: number
    readonly carryoverYears: number
  }[]
  /** Excess MCIT over RCIT creditable against RCIT in the N following years. */
  readonly mcitExcessCarryoverYears: number
}

/** RA 11494 (Bayanihan II) + RR 25-2020: losses of 2020 and 2021 carry 5 years. */
const NOLCO_EXTENDED_WINDOWS = [
  { lossYearFrom: 2020, lossYearTo: 2021, carryoverYears: 5 },
] as const

const P = (pesos: number) => pesos * 100

export const CORPORATE_TAX_RULES: readonly CorporateTaxRuleBlock[] = [
  {
    effectiveFrom: '2009-01-01',
    effectiveTo: '2020-06-30',
    source: 'NIRC pre-CREATE (30% RCIT, 2% MCIT)',
    rcitStandardRate: pct(30),
    rcitReducedRate: null,
    rcitReducedNetIncomeCapCentavos: null,
    rcitReducedAssetCapCentavos: null,
    mcitRate: pct(2),
    mcitStartYear: 4,
    osdRate: pct(40),
    specialIncentiveRate: pct(5),
    nolcoCarryoverYears: 3,
    nolcoExtendedWindows: NOLCO_EXTENDED_WINDOWS,
    mcitExcessCarryoverYears: 3,
  },
  {
    effectiveFrom: '2020-07-01',
    effectiveTo: '2023-06-30',
    source: 'RA 11534 (CREATE): 25%/20% RCIT, MCIT temporarily 1%',
    rcitStandardRate: pct(25),
    rcitReducedRate: pct(20),
    rcitReducedNetIncomeCapCentavos: P(5_000_000),
    rcitReducedAssetCapCentavos: P(100_000_000),
    mcitRate: pct(1),
    mcitStartYear: 4,
    osdRate: pct(40),
    specialIncentiveRate: pct(5),
    nolcoCarryoverYears: 3,
    nolcoExtendedWindows: NOLCO_EXTENDED_WINDOWS,
    mcitExcessCarryoverYears: 3,
  },
  {
    effectiveFrom: '2023-07-01',
    effectiveTo: null,
    source: 'CREATE (MCIT back to 2%); CREATE MORE (RA 12066) 20% RBE rate handled via incentive regime',
    rcitStandardRate: pct(25),
    rcitReducedRate: pct(20),
    rcitReducedNetIncomeCapCentavos: P(5_000_000),
    rcitReducedAssetCapCentavos: P(100_000_000),
    mcitRate: pct(2),
    mcitStartYear: 4,
    osdRate: pct(40),
    specialIncentiveRate: pct(5),
    nolcoCarryoverYears: 3,
    nolcoExtendedWindows: NOLCO_EXTENDED_WINDOWS,
    mcitExcessCarryoverYears: 3,
  },
]
