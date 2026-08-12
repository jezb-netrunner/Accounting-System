import { pct, type Rate } from '../../lib/money'
import type { ISODate } from '../../domain/core'
import type { EffectivityBlock } from './types'

/**
 * Input VAT on capital goods: Sec. 110(A) requires spreading ("amortizing")
 * the input VAT over useful life (capped) when the month's aggregate
 * acquisition cost exceeds the threshold. CREATE sunset the requirement:
 * acquisitions AFTER `amortizationSunset` are fully creditable on purchase,
 * while schedules already running continue until fully utilized.
 */
export interface CapitalGoodsRule {
  /** Aggregate acquisition cost (net of VAT) per calendar month above which amortization applied. */
  readonly monthlyAggregateThresholdCentavos: number
  readonly maxAmortizationMonths: number
  /** Acquisitions on or before this date amortize; after it, fully creditable. Null = still in force. */
  readonly amortizationSunset: ISODate | null
}

export interface VatRuleBlock extends EffectivityBlock {
  readonly standardRate: Rate
  readonly zeroRate: Rate
  /** Creditable VAT withheld on sales to government (final pre-2021, creditable per CREATE). */
  readonly governmentWithholdingRate: Rate
  /** Null = no amortization regime existed for the block. */
  readonly capitalGoods: CapitalGoodsRule | null
}

const P = (pesos: number) => pesos * 100

export const VAT_RULES: readonly VatRuleBlock[] = [
  {
    effectiveFrom: '1988-01-01',
    effectiveTo: '2006-01-31',
    source: 'EO 273 (original VAT law)',
    standardRate: pct(10),
    zeroRate: pct(0),
    governmentWithholdingRate: pct(5),
    capitalGoods: null,
  },
  {
    effectiveFrom: '2006-02-01',
    effectiveTo: null,
    source: 'RA 9337 (RVAT) 12%; RA 11534 (CREATE) sunset of capital-goods input VAT amortization',
    standardRate: pct(12),
    zeroRate: pct(0),
    governmentWithholdingRate: pct(5),
    capitalGoods: {
      monthlyAggregateThresholdCentavos: P(1_000_000),
      maxAmortizationMonths: 60,
      // CREATE Sec. 110(A): amortization allowed only until 2021-12-31;
      // purchases from 2022-01-01 are fully creditable outright.
      amortizationSunset: '2021-12-31',
    },
  },
]
