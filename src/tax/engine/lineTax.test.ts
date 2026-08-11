import { describe, expect, it } from 'vitest'
import { Money } from '../../lib/money'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
  VAT_CORPORATION_PROFILE,
} from '../../seed/profiles'
import { deriveDocumentTotals, deriveLineTax, type DocumentTaxContext } from './lineTax'
import { validateTaxProfile } from '../../domain/taxProfile'

const D = '2026-04-10'

const ctx = (overrides: Partial<DocumentTaxContext>): DocumentTaxContext => ({
  profile: VAT_CORPORATION_PROFILE,
  direction: 'sale',
  date: D,
  counterpartyClass: 'corporation',
  counterpartyIsGovernment: false,
  ...overrides,
})

describe('demo profiles are internally consistent', () => {
  it.each([
    ['VAT corporation', VAT_CORPORATION_PROFILE],
    ['8% professional', EIGHT_PERCENT_PROFESSIONAL_PROFILE],
    ['percentage-tax sole prop', PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE],
  ])('%s', (_name, profile) => {
    expect(validateTaxProfile(profile)).toEqual([])
  })
})

describe('profile-driven line derivation', () => {
  it('VAT company sale: extracts output VAT from inclusive price', () => {
    const r = deriveLineTax(ctx({}), {
      amount: Money.parse('11200.00'),
      amountIsVatInclusive: true,
      vatClass: 'vatable',
      atc: null,
    })
    expect(r.net.format()).toBe('10,000.00')
    expect(r.vat.format()).toBe('1,200.00')
  })

  it('non-VAT professional sale: never derives VAT, whatever the line says', () => {
    const r = deriveLineTax(
      ctx({ profile: EIGHT_PERCENT_PROFESSIONAL_PROFILE }),
      { amount: Money.parse('11200.00'), amountIsVatInclusive: true, vatClass: 'vatable', atc: null },
    )
    expect(r.vat.isZero()).toBe(true)
    expect(r.net.format()).toBe('11,200.00')
    expect(r.vatClass).toBeNull()
  })

  it('VAT company purchase with ATC: withholds on the VAT-exclusive base', () => {
    const r = deriveLineTax(
      ctx({ direction: 'purchase', counterpartyClass: 'individual' }),
      { amount: Money.parse('11200.00'), amountIsVatInclusive: true, vatClass: 'vatable', atc: 'WI010' },
    )
    expect(r.vat.format()).toBe('1,200.00') // input VAT
    expect(r.withholding?.amount.format()).toBe('500.00') // 5% of 10,000 net
  })

  it('non-agent company never withholds even when an ATC is present', () => {
    const r = deriveLineTax(
      ctx({ profile: EIGHT_PERCENT_PROFESSIONAL_PROFILE, direction: 'purchase' }),
      { amount: Money.pesos(10_000), amountIsVatInclusive: false, vatClass: 'vatable', atc: 'WC120' },
    )
    expect(r.withholding).toBeNull()
  })

  it('exempt and zero-rated lines coexist on one document', () => {
    const { totals } = deriveDocumentTotals(ctx({}), [
      { amount: Money.parse('11200.00'), amountIsVatInclusive: true, vatClass: 'vatable', atc: null },
      { amount: Money.pesos(5_000), amountIsVatInclusive: true, vatClass: 'exempt', atc: null },
      { amount: Money.pesos(8_000), amountIsVatInclusive: true, vatClass: 'zero_rated', atc: null },
    ])
    expect(totals.vatableNet.format()).toBe('10,000.00')
    expect(totals.exemptNet.format()).toBe('5,000.00')
    expect(totals.zeroRatedNet.format()).toBe('8,000.00')
    expect(totals.vat.format()).toBe('1,200.00')
    expect(totals.gross.format()).toBe('24,200.00')
  })

  it('sale to government: 5% VAT withheld reduces the amount due', () => {
    const { totals } = deriveDocumentTotals(
      ctx({ counterpartyIsGovernment: true }),
      [{ amount: Money.parse('11200.00'), amountIsVatInclusive: true, vatClass: 'vatable', atc: null }],
    )
    expect(totals.governmentVatWithheld.format()).toBe('500.00')
    expect(totals.amountDue.format()).toBe('10,700.00')
  })

  it('withholding agent sole proprietor withholds despite being non-VAT', () => {
    const r = deriveLineTax(
      ctx({
        profile: PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
        direction: 'purchase',
        counterpartyClass: 'corporation',
      }),
      { amount: Money.pesos(20_000), amountIsVatInclusive: false, vatClass: 'vatable', atc: 'WC100' },
    )
    // Non-VAT buyer: input VAT not creditable, gross is cost...
    expect(r.vat.isZero()).toBe(true)
    // ...but rent still withholds 5% EWT on the payment.
    expect(r.withholding?.amount.format()).toBe('1,000.00')
  })
})
