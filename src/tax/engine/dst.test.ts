import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import { computeDst, findDstRule } from './dst'

const D = '2026-01-15'

describe('documentary stamp tax', () => {
  it('original issue of shares: ₱2 per ₱200 of par', () => {
    const rule = findDstRule('Sec. 174', D)
    expect(computeDst(rule, Money.pesos(1_000_000)).format()).toBe('10,000.00')
  })

  it('counts fractional units with a ceiling ("or fraction thereof")', () => {
    const rule = findDstRule('Sec. 179', D)
    // ₱500,100 debt: ceil(500,100/200) = 2,501 units × ₱1.50 = 3,751.50
    expect(computeDst(rule, Money.pesos(500_100)).format()).toBe('3,751.50')
  })

  it('lease: ₱6 on the first ₱2,000 plus ₱2 per ₱1,000 of excess', () => {
    const rule = findDstRule('Sec. 194', D)
    expect(computeDst(rule, Money.pesos(2_000)).format()).toBe('6.00')
    expect(computeDst(rule, Money.pesos(10_000)).format()).toBe('22.00')
  })

  it('flat-amount documents ignore the base', () => {
    const rule = findDstRule('Sec. 188', D)
    expect(computeDst(rule, Money.pesos(999_999)).format()).toBe('30.00')
  })
})
