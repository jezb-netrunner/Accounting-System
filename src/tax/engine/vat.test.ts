import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import { allocateInputVat, deriveVat } from './vat'

const D = '2026-03-15'

describe('deriveVat', () => {
  it('extracts VAT from an inclusive amount', () => {
    const r = deriveVat(Money.parse('11200.00'), 'vatable', true, D)
    expect(r.net.format()).toBe('10,000.00')
    expect(r.vat.format()).toBe('1,200.00')
    expect(r.gross.format()).toBe('11,200.00')
  })

  it('adds VAT on top of an exclusive amount', () => {
    const r = deriveVat(Money.parse('10000.00'), 'vatable', false, D)
    expect(r.vat.format()).toBe('1,200.00')
    expect(r.gross.format()).toBe('11,200.00')
  })

  it('net + vat always reconstructs gross exactly (no lost centavo)', () => {
    for (const cents of [100, 101, 112, 113, 99999, 1234567]) {
      const gross = Money.fromCentavos(cents)
      const r = deriveVat(gross, 'vatable', true, D)
      expect(r.net.add(r.vat).centavos).toBe(gross.centavos)
    }
  })

  it('exempt and zero-rated lines carry no VAT but keep their class', () => {
    expect(deriveVat(Money.pesos(500), 'exempt', true, D).vat.isZero()).toBe(true)
    expect(deriveVat(Money.pesos(500), 'zero_rated', true, D).vatClass).toBe('zero_rated')
  })

  it('uses the 10% rate for pre-2006 historical dates', () => {
    const r = deriveVat(Money.parse('110.00'), 'vatable', true, '2005-06-15')
    expect(r.net.format()).toBe('100.00')
    expect(r.vat.format()).toBe('10.00')
  })
})

describe('allocateInputVat (mixed transactions)', () => {
  it('splits pro-rata by sales mix without losing a centavo', () => {
    const r = allocateInputVat(Money.parse('12000.00'), {
      vatable: Money.pesos(600_000),
      zeroRated: Money.pesos(300_000),
      exempt: Money.pesos(100_000),
    })
    expect(r.creditable.format()).toBe('7,200.00')
    expect(r.attributableToZeroRated.format()).toBe('3,600.00')
    expect(r.expensed.format()).toBe('1,200.00')
    const total = r.creditable.add(r.attributableToZeroRated).add(r.expensed)
    expect(total.format()).toBe('12,000.00')
  })

  it('handles awkward ratios exactly', () => {
    const input = Money.fromCentavos(10_001)
    const r = allocateInputVat(input, {
      vatable: Money.pesos(1),
      zeroRated: Money.pesos(1),
      exempt: Money.pesos(1),
    })
    const total = r.creditable.add(r.attributableToZeroRated).add(r.expensed)
    expect(total.centavos).toBe(10_001)
  })

  it('parks input VAT as creditable when the period has no sales', () => {
    const r = allocateInputVat(Money.pesos(100), {
      vatable: Money.ZERO,
      zeroRated: Money.ZERO,
      exempt: Money.ZERO,
    })
    expect(r.creditable.format()).toBe('100.00')
  })
})
