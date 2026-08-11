import { describe, expect, it } from 'vitest'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
  VAT_CORPORATION_PROFILE,
} from './profiles'
import { coaTemplateForProfile } from './coaTemplates'

const codes = (rows: { code: string }[]) => rows.map((r) => r.code)

describe('coaTemplateForProfile', () => {
  it('gives a VAT corporation the VAT, EWT, payroll, and DST accounts', () => {
    const c = codes(coaTemplateForProfile(VAT_CORPORATION_PROFILE))
    for (const code of ['1400', '2200', '2300', '2320', '5200', '2420']) {
      expect(c, code).toContain(code)
    }
    expect(c).not.toContain('2410') // no percentage tax payable for a VAT registrant
    expect(c).not.toContain('2310') // not a final withholding agent
  })

  it('gives an 8% professional no VAT and no payroll accounts', () => {
    const c = codes(coaTemplateForProfile(EIGHT_PERCENT_PROFESSIONAL_PROFILE))
    for (const code of ['1400', '1410', '2200', '2210', '4110', '4120', '2320', '5200', '2300']) {
      expect(c, code).not.toContain(code)
    }
    expect(c).toContain('2410') // registered for percentage tax (election suppresses the return)
  })

  it('gives the percentage-tax store EWT payable but no VAT accounts', () => {
    const c = codes(coaTemplateForProfile(PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE))
    expect(c).toContain('2300')
    expect(c).toContain('2410')
    expect(c).not.toContain('2200')
  })

  it('always keeps the structural role accounts', () => {
    for (const p of [
      VAT_CORPORATION_PROFILE,
      EIGHT_PERCENT_PROFESSIONAL_PROFILE,
      PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
    ]) {
      const c = codes(coaTemplateForProfile(p))
      for (const code of ['1100', '1200', '2100', '4100', '5100', '3100', '3200']) {
        expect(c, code).toContain(code)
      }
    }
  })

  it('renames the single revenue line for non-VAT companies', () => {
    const rows = coaTemplateForProfile(EIGHT_PERCENT_PROFESSIONAL_PROFILE)
    expect(rows.find((r) => r.code === '4100')!.name).toBe('Sales / Service Income')
  })
})
