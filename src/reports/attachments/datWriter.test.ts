import { describe, expect, it } from 'vitest'
import { tin } from '../../domain/core'
import { Money } from '../../lib/money'
import {
  alphalistDraftCsv,
  qapDraftCsv,
  qapWriter,
  slspWriter,
  sawtWriter,
  annualAlphalistWriter,
  type QapModel,
  type SlspModel,
} from './datWriter'
import { FORMAT_SPECS, UnverifiedFormatError } from './formatSpecs'

const qapModel: QapModel = {
  agentTin: tin('001234567'),
  agentName: 'Test Corp',
  quarterEnd: '2026-03-31',
  kind: 'EQ',
  rows: [
    {
      payeeTin: tin('301111111'),
      payeeName: 'Landlord Corp.',
      atc: 'WC100',
      incomePayment: Money.pesos(100_000),
      ratePercent: 5,
      taxWithheld: Money.pesos(5_000),
    },
  ],
}

const slspModel: SlspModel = {
  ownerTin: tin('001234567'),
  ownerName: 'Test Corp',
  periodFrom: '2026-01-01',
  periodTo: '2026-03-31',
  sales: [],
  purchases: [],
}

describe('.DAT writers refuse unverified layouts', () => {
  it('throws UnverifiedFormatError pointing at the spec file', () => {
    expect(() => qapWriter.write(qapModel)).toThrow(UnverifiedFormatError)
    expect(() => qapWriter.write(qapModel)).toThrow(/docs\/bir-formats\/qap-dat\.md/)
    expect(() => slspWriter.write(slspModel)).toThrow(UnverifiedFormatError)
    expect(() => sawtWriter.write({ claimantTin: tin('001234567'), claimantName: 'x', returnPeriodEnd: '2026-03-31', attachedToForm: '1702Q', rows: [] })).toThrow(UnverifiedFormatError)
    expect(() => annualAlphalistWriter.write({ agentTin: tin('001234567'), agentName: 'x', year: 2026, variant: 'C', employees: [] })).toThrow(UnverifiedFormatError)
  })

  // These are the DELIBERATELY FAILING tests the format work is gated on:
  // once a layout is verified (docs/bir-formats/*.md filled in and
  // formatSpecs.ts flipped to verified: true), the writer stops throwing,
  // the `.fails` wrapper itself fails, and whoever flips the flag must
  // replace these with assertions pinning the real record layout.
  it.fails('QAP .DAT emits a submission file (blocked: layout UNVERIFIED — see docs/bir-formats/qap-dat.md)', () => {
    expect(() => qapWriter.write(qapModel)).not.toThrow()
  })
  it.fails('SLSP .DAT emits a submission file (blocked: layout UNVERIFIED — see docs/bir-formats/slsp-dat.md)', () => {
    expect(() => slspWriter.write(slspModel)).not.toThrow()
  })

  it('every registered format is currently unverified and documented', () => {
    for (const spec of Object.values(FORMAT_SPECS)) {
      expect(spec.verified).toBe(false)
      expect(spec.specFile).toMatch(/^docs\/bir-formats\//)
    }
  })
})

describe('draft CSV fallbacks', () => {
  it('emit review data behind an unmistakable not-for-submission banner', () => {
    const f = qapDraftCsv(qapModel)
    expect(f.filename).toContain('draft')
    expect(f.content.split('\r\n')[0]).toMatch(/NOT the BIR \.DAT layout/)
    expect(f.content).toContain('WC100')
    expect(f.content).toContain('5,000.00')
  })

  it('alphalist draft includes employee rows', () => {
    const f = alphalistDraftCsv({
      agentTin: tin('001234567'),
      agentName: 'Test Corp',
      year: 2026,
      variant: 'C',
      employees: [
        {
          tin: tin('101111111'),
          lastName: 'Cruz',
          firstName: 'Juan',
          middleName: '',
          grossCompensation: Money.pesos(480_000),
          nonTaxable: Money.ZERO,
          taxable: Money.pesos(480_000),
          taxWithheld: Money.pesos(38_500),
          employedFrom: '2024-01-01',
          employedTo: null,
        },
      ],
    })
    expect(f.content).toContain('Cruz')
    expect(f.content.split('\r\n')[0]).toMatch(/DRAFT FOR REVIEW ONLY/)
  })
})
