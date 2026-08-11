import { describe, expect, it } from 'vitest'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
  VAT_CORPORATION_PROFILE,
} from '../seed/profiles'
import { filingCalendar, obligationsArisingFrom } from './filingCalendar'

const codes = (obs: { formCode: string }[]) => obs.map((o) => o.formCode)

describe('filingCalendar — profile drives which forms exist', () => {
  it('VAT corporation, April: 2550Q + 1601-EQ (Q1), 1601-C, 2000', () => {
    const obs = filingCalendar(VAT_CORPORATION_PROFILE, { year: 2026, month: 4 })
    const c = codes(obs)
    expect(c).toContain('2550Q')
    expect(c).toContain('1601-EQ')
    expect(c).toContain('1601-C')
    expect(c).toContain('2000')
    expect(c).not.toContain('2551Q') // VAT-registered: never percentage tax
    const vat = obs.find((o) => o.formCode === '2550Q')!
    expect(vat.deadline).toBe('2026-04-25')
    expect(vat.periodCovered).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(vat.attachments[0]).toMatch(/SLSP/)
  })

  it('a non-VAT professional never sees 2550Q', () => {
    for (let month = 1; month <= 12; month++) {
      const c = codes(filingCalendar(EIGHT_PERCENT_PROFESSIONAL_PROFILE, { year: 2026, month }))
      expect(c).not.toContain('2550Q')
    }
  })

  it('8% election suppresses 2551Q; percentage-tax sole prop keeps it', () => {
    const aprEight = codes(filingCalendar(EIGHT_PERCENT_PROFESSIONAL_PROFILE, { year: 2026, month: 4 }))
    expect(aprEight).not.toContain('2551Q')
    const aprPct = codes(filingCalendar(PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE, { year: 2026, month: 4 }))
    expect(aprPct).toContain('2551Q')
  })

  it('individual annual return: 1701A for pure-business 8%/OSD, due Apr 15', () => {
    const apr = filingCalendar(EIGHT_PERCENT_PROFESSIONAL_PROFILE, { year: 2027, month: 4 })
    const annual = apr.find((o) => o.formCode === '1701A')
    expect(annual).toBeDefined()
    expect(annual!.deadline).toBe('2027-04-15')
    expect(annual!.periodCovered).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('corporation annual return is 1702-RT due 15th of 4th month after FY end', () => {
    const apr = filingCalendar(VAT_CORPORATION_PROFILE, { year: 2027, month: 4 })
    const annual = apr.find((o) => o.formCode === '1702-RT')
    expect(annual).toBeDefined()
    expect(annual!.deadline).toBe('2027-04-15')
  })

  it('1601-C December remittance gets the January 15 deadline', () => {
    const jan = filingCalendar(VAT_CORPORATION_PROFILE, { year: 2027, month: 1 })
    const dec1601c = jan.find(
      (o) => o.formCode === '1601-C' && o.periodCovered.from === '2026-12-01',
    )
    expect(dec1601c?.deadline).toBe('2027-01-15')
  })

  it('withholding monthlies (0619-E) appear only in non-quarter-end months', () => {
    const feb = obligationsArisingFrom(VAT_CORPORATION_PROFILE, { year: 2026, month: 2 })
    expect(codes(feb)).toContain('0619-E')
    const mar = obligationsArisingFrom(VAT_CORPORATION_PROFILE, { year: 2026, month: 3 })
    expect(codes(mar)).not.toContain('0619-E')
    expect(codes(mar)).toContain('1601-EQ')
  })

  it('annual information returns land in January-March of the following year', () => {
    const jan = codes(filingCalendar(VAT_CORPORATION_PROFILE, { year: 2027, month: 1 }))
    expect(jan).toContain('1604-C')
    const mar = codes(filingCalendar(VAT_CORPORATION_PROFILE, { year: 2027, month: 3 }))
    expect(mar).toContain('1604-E')
  })

  it('0605 registration fee exists for pre-EOPT years only (rules-driven)', () => {
    expect(codes(filingCalendar(VAT_CORPORATION_PROFILE, { year: 2023, month: 1 }))).toContain('0605')
    expect(codes(filingCalendar(VAT_CORPORATION_PROFILE, { year: 2026, month: 1 }))).not.toContain('0605')
  })
})

describe('filingCalendar — fiscal years that do not end in December', () => {
  const fiscalCorp = {
    ...VAT_CORPORATION_PROFILE,
    fiscalYearEndMonth: 6, // FY ends June 30
  }

  it('annual 1702 is due Oct 15 for a June 30 year-end', () => {
    const oct = filingCalendar(fiscalCorp, { year: 2026, month: 10 })
    const annual = oct.find((o) => o.formCode === '1702-RT')
    expect(annual).toBeDefined()
    expect(annual!.deadline).toBe('2026-10-15')
    expect(annual!.periodCovered).toEqual({ from: '2025-07-01', to: '2026-06-30' })
  })

  it('VAT quarters follow the fiscal year (quarter ends Sep 30 → 2550Q due Oct 25)', () => {
    const oct = filingCalendar(fiscalCorp, { year: 2026, month: 10 })
    const vat = oct.find((o) => o.formCode === '2550Q')
    expect(vat).toBeDefined()
    expect(vat!.periodCovered).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(vat!.deadline).toBe('2026-10-25')
  })
})
