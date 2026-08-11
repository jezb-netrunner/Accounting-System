import { describe, expect, it } from 'vitest'
import { Money, mulDivHalfUp, pct, rate, sum } from './money'

describe('Money construction', () => {
  it('parses decimal strings exactly', () => {
    expect(Money.parse('1234.56').centavos).toBe(123_456)
    expect(Money.parse('0.05').centavos).toBe(5)
    expect(Money.parse('1,000,000.00').centavos).toBe(100_000_000)
    expect(Money.parse('-25.5').centavos).toBe(-2550)
  })

  it('rejects floats and malformed input', () => {
    expect(() => Money.fromCentavos(1.5)).toThrow()
    expect(() => Money.parse('1.234')).toThrow()
    expect(() => Money.parse('abc')).toThrow()
    expect(() => Money.pesos(0.5)).toThrow()
  })
})

describe('half-up rounding (BIR convention)', () => {
  it('rounds .5 exactly upward', () => {
    // 125 * 1/2 = 62.5 → 63
    expect(mulDivHalfUp(125, 1, 2)).toBe(63)
    // 135 * 1/2 = 67.5 → 68 (no banker's rounding)
    expect(mulDivHalfUp(135, 1, 2)).toBe(68)
  })

  it('rounds below .5 down and above .5 up', () => {
    expect(mulDivHalfUp(124, 1, 2)).toBe(62)
    expect(mulDivHalfUp(1001, 1, 3)).toBe(334) // 333.67 → 334
    expect(mulDivHalfUp(1000, 1, 3)).toBe(333) // 333.33 → 333
  })

  it('rounds negative .5 away from zero (mirrors positives)', () => {
    expect(mulDivHalfUp(-125, 1, 2)).toBe(-63)
    expect(mulDivHalfUp(-124, 1, 2)).toBe(-62)
  })

  it('avoids float precision traps', () => {
    // 12% of 1,000,000.05: exact product is 120,000.006 → 12,000,001 centavos...
    // 100000005 * 12 / 100 = 12000000.6 → 12000001
    expect(mulDivHalfUp(100_000_005, 12, 100)).toBe(12_000_001)
    // Large values that would overflow float64 multiplication stay exact via BigInt
    expect(mulDivHalfUp(9_007_199_254_740_991, 1, 1)).toBe(9_007_199_254_740_991)
  })
})

describe('VAT-style extraction (gross → net)', () => {
  it('extracts 12% VAT from inclusive gross', () => {
    const gross = Money.parse('112.00')
    const net = gross.multiply(rate(100, 112))
    const vat = gross.subtract(net)
    expect(net.format()).toBe('100.00')
    expect(vat.format()).toBe('12.00')
  })

  it('handles non-terminating division with half-up', () => {
    const gross = Money.parse('100.00')
    // net = 100 * 100/112 = 89.2857... → 89.29
    expect(gross.multiply(rate(100, 112)).format()).toBe('89.29')
  })
})

describe('percent helper', () => {
  it('supports fractional percents exactly', () => {
    expect(Money.pesos(10_000).multiply(pct(0.75)).format()).toBe('75.00')
    expect(Money.pesos(200).multiply(pct(12)).format()).toBe('24.00')
  })
})

describe('allocate', () => {
  it('splits without losing a centavo', () => {
    const parts = Money.fromCentavos(100).allocate([1, 1, 1])
    expect(parts.map((p) => p.centavos)).toEqual([34, 33, 33])
    expect(sum(parts).centavos).toBe(100)
  })

  it('splits proportionally', () => {
    const parts = Money.parse('1000.00').allocate([70, 30])
    expect(parts[0]!.format()).toBe('700.00')
    expect(parts[1]!.format()).toBe('300.00')
  })
})

describe('formatting', () => {
  it('formats with thousands separators', () => {
    expect(Money.fromCentavos(123_456_789).format()).toBe('1,234,567.89')
    expect(Money.fromCentavos(-5).format()).toBe('-0.05')
  })
})
