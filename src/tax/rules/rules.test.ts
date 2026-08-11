import { describe, expect, it } from 'vitest'
import { addDays } from '../../domain/core'
import {
  COMPENSATION_WITHHOLDING_RULES,
  CORPORATE_TAX_RULES,
  DST_RULES,
  INDIVIDUAL_INCOME_TAX_RULES,
  PERCENTAGE_TAX_RULES,
  RuleNotFoundError,
  THRESHOLD_RULES,
  VAT_RULES,
  WITHHOLDING_RULES,
  rules,
  type EffectivityBlock,
} from './index'

const TABLES: Record<string, readonly EffectivityBlock[]> = {
  vat: VAT_RULES,
  percentageTax: PERCENTAGE_TAX_RULES,
  individualIncomeTax: INDIVIDUAL_INCOME_TAX_RULES,
  corporate: CORPORATE_TAX_RULES,
  withholding: WITHHOLDING_RULES,
  compensationWithholding: COMPENSATION_WITHHOLDING_RULES,
  dst: DST_RULES,
  thresholds: THRESHOLD_RULES,
}

describe('rule table integrity', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    it(`${name}: blocks are contiguous, non-overlapping, and end open`, () => {
      expect(table.length).toBeGreaterThan(0)
      for (let i = 0; i < table.length - 1; i++) {
        const current = table[i]!
        const next = table[i + 1]!
        expect(current.effectiveTo, `${name}[${i}] must close before a successor`).not.toBeNull()
        expect(addDays(current.effectiveTo!, 1)).toBe(next.effectiveFrom)
      }
      expect(table[table.length - 1]!.effectiveTo).toBeNull()
    })

    it(`${name}: every block cites its source`, () => {
      for (const block of table) expect(block.source.length).toBeGreaterThan(3)
    })
  }
})

describe('date-based resolution', () => {
  it('resolves the percentage-tax rate across the CREATE window', () => {
    expect(rules.percentageTax('2020-06-30').rate).toEqual({ num: 30_000, den: 1_000_000 })
    expect(rules.percentageTax('2020-07-01').rate).toEqual({ num: 10_000, den: 1_000_000 })
    expect(rules.percentageTax('2023-06-30').rate).toEqual({ num: 10_000, den: 1_000_000 })
    expect(rules.percentageTax('2023-07-01').rate).toEqual({ num: 30_000, den: 1_000_000 })
  })

  it('resolves individual brackets by taxable year (2022 vs 2023 schedules)', () => {
    expect(rules.individualIncomeTax('2022-12-31').brackets[1]!.marginalRate).toEqual({
      num: 200_000,
      den: 1_000_000,
    })
    expect(rules.individualIncomeTax('2023-01-01').brackets[1]!.marginalRate).toEqual({
      num: 150_000,
      den: 1_000_000,
    })
  })

  it('resolves MCIT rate across the CREATE relief window', () => {
    expect(rules.corporateTax('2022-01-01').mcitRate).toEqual({ num: 10_000, den: 1_000_000 })
    expect(rules.corporateTax('2024-01-01').mcitRate).toEqual({ num: 20_000, den: 1_000_000 })
  })

  it('EOPT flips services to invoice-based recognition from 2024', () => {
    expect(rules.thresholds('2023-12-31').invoiceBasedRecognitionForServices).toBe(false)
    expect(rules.thresholds('2024-01-01').invoiceBasedRecognitionForServices).toBe(true)
  })

  it('throws a helpful error for dates before any block', () => {
    expect(() => rules.percentageTax('1990-01-01')).toThrow(RuleNotFoundError)
  })
})

describe('ATC lookups', () => {
  it('finds rates by ATC code', () => {
    const wi010 = rules.atc('2026-01-15', 'WI010')
    expect(wi010?.rate).toEqual({ num: 50_000, den: 1_000_000 })
    expect(wi010?.higherRateThresholdCentavos).toBe(300_000_000)
  })

  it('filters ATCs by payee class', () => {
    const forCorps = rules.atcsForPayee('2026-01-15', 'corporation')
    expect(forCorps.length).toBeGreaterThan(0)
    expect(forCorps.every((r) => r.payeeClass === 'corporation')).toBe(true)
  })
})
