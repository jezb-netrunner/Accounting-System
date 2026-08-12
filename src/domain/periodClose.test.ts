import { describe, expect, it } from 'vitest'
import { Money } from '../lib/money'
import { instantiateTemplate } from './coa'
import { createJournalEntry } from './journal'
import {
  assertPostingAllowed,
  blockersPass,
  lockPeriod,
  validatePeriodClose,
  type CloseValidationInput,
} from './periodClose'
import type { Sheet } from './sheets'
import { coaTemplateForProfile } from '../seed/coaTemplates'
import { VAT_CORPORATION_PROFILE } from '../seed/profiles'

const accounts = instantiateTemplate('co', coaTemplateForProfile(VAT_CORPORATION_PROFILE))

const entry = (id: string, date: string, sheetId: string | null = null) =>
  createJournalEntry({
    id,
    companyId: 'co',
    entryNo: Number(id.replace(/\D/g, '') || 1),
    date,
    description: id,
    sheetId,
    postedAt: `${date}T00:00:00Z`,
    lines: [
      { accountCode: '1200', debit: Money.pesos(100), partyId: 'p1' },
      { accountCode: '4100', credit: Money.pesos(100), partyId: 'p1' },
    ],
  })

const sheet = (id: string, date: string, status: Sheet['status']): Sheet => ({
  id,
  companyId: 'co',
  type: 'sales_invoice',
  documentNo: id,
  date,
  partyId: 'p1',
  memo: '',
  lines: [],
  status,
  postedEntryId: null,
  bankAccountCode: null,
  payrollPeriod: null,
})

const base = (over: Partial<CloseValidationInput> = {}): CloseValidationInput => ({
  period: { year: 2026, month: 3 },
  profile: VAT_CORPORATION_PROFILE,
  sheets: [],
  entries: [],
  accounts,
  locks: [],
  generatedReturns: [],
  ...over,
})

describe('validatePeriodClose', () => {
  it('drafts in the period are a blocker', () => {
    const checks = validatePeriodClose(base({ sheets: [sheet('S-1', '2026-03-10', 'draft')] }))
    const c = checks.find((x) => x.id === 'no_draft_sheets')!
    expect(c.severity).toBe('blocker')
    expect(c.passed).toBe(false)
    expect(c.detail).toContain('S-1')
    expect(blockersPass(checks)).toBe(false)
  })

  it('an earlier period with activity but no lock is a blocker; a locked one passes', () => {
    const withActivity = base({ entries: [entry('e1', '2026-02-10')] })
    expect(validatePeriodClose(withActivity).find((c) => c.id === 'prior_periods_closed')!.passed).toBe(false)

    const locked = base({
      entries: [entry('e1', '2026-02-10')],
      locks: [{ companyId: 'co', periodKey: '2026-02', lockedAt: '', lockedBy: 't' }],
    })
    expect(validatePeriodClose(locked).find((c) => c.id === 'prior_periods_closed')!.passed).toBe(true)
  })

  it('the trial balance tie is checked as a blocker (and ties by construction)', () => {
    const checks = validatePeriodClose(base({ entries: [entry('e1', '2026-03-05')] }))
    const c = checks.find((x) => x.id === 'trial_balance_ties')!
    expect(c.severity).toBe('blocker')
    expect(c.passed).toBe(true)
  })

  it('unattributed control-account postings are a warning, not a blocker', () => {
    const orphan = createJournalEntry({
      id: 'e9',
      companyId: 'co',
      entryNo: 9,
      date: '2026-03-07',
      description: 'direct AR posting without a party',
      postedAt: '2026-03-07T00:00:00Z',
      lines: [
        { accountCode: '1200', debit: Money.pesos(50) }, // no partyId
        { accountCode: '4100', credit: Money.pesos(50) },
      ],
    })
    const checks = validatePeriodClose(base({ entries: [orphan] }))
    const c = checks.find((x) => x.id === 'subledger_accounts_receivable')!
    expect(c.severity).toBe('warning')
    expect(c.passed).toBe(false)
    expect(blockersPass(checks)).toBe(true)
  })

  it('VAT and withholding recon compare ledger against document-derived figures', () => {
    const vat = createJournalEntry({
      id: 'e2',
      companyId: 'co',
      entryNo: 2,
      date: '2026-03-08',
      description: 'sale with VAT',
      postedAt: '2026-03-08T00:00:00Z',
      lines: [
        { accountCode: '1200', debit: Money.pesos(112) },
        { accountCode: '4100', credit: Money.pesos(100) },
        { accountCode: '2200', credit: Money.pesos(12), taxTag: 'output_vat' },
      ],
    })
    const ok = validatePeriodClose(base({ entries: [vat], derivedOutputVatCentavos: 1200 }))
    expect(ok.find((c) => c.id === 'vat_base_recon')!.passed).toBe(true)
    const bad = validatePeriodClose(base({ entries: [vat], derivedOutputVatCentavos: 1100 }))
    expect(bad.find((c) => c.id === 'vat_base_recon')!.passed).toBe(false)
  })

  it('missing required returns for the period are a warning', () => {
    // March = fiscal Q1 end for a calendar-year VAT corp → 2550Q + 1601-EQ etc. arise.
    const none = validatePeriodClose(base())
    const c = none.find((x) => x.id === 'returns_generated')!
    expect(c.passed).toBe(false)
    expect(c.detail).toContain('2550Q')

    const with2550 = validatePeriodClose(
      base({
        generatedReturns: [
          '2550Q', '1601-EQ', '1601-C', '1702Q', '2000',
        ].map((formCode) => ({
          id: `co:${formCode}:x`,
          companyId: 'co',
          formCode,
          periodFrom: '2026-01-01',
          periodTo: formCode === '1601-C' || formCode === '2000' ? '2026-03-31' : '2026-03-31',
          generatedAt: '',
          figures: {},
        })),
      }),
    )
    expect(with2550.find((x) => x.id === 'returns_generated')!.passed).toBe(true)
  })
})

describe('lockPeriod / assertPostingAllowed', () => {
  it('locks only when blockers pass, then blocks posting into the period', () => {
    const withDraft = base({ sheets: [sheet('S-1', '2026-03-10', 'draft')] })
    expect(() =>
      lockPeriod({ ...withDraft, companyId: 'co', lockedBy: 'me', now: '2026-04-01T00:00:00Z' }),
    ).toThrow(/Cannot close/)

    const lock = lockPeriod({ ...base(), companyId: 'co', lockedBy: 'me', now: '2026-04-01T00:00:00Z' })
    expect(lock.periodKey).toBe('2026-03')
    expect(() => assertPostingAllowed('2026-03-15', [lock])).toThrow(/locked/)
    expect(() => assertPostingAllowed('2026-04-01', [lock])).not.toThrow()
  })

  it('warnings alone never block the lock', () => {
    // Missing returns (warning) but no blockers → lock succeeds.
    const lock = lockPeriod({ ...base(), companyId: 'co', lockedBy: 'me', now: '2026-04-01T00:00:00Z' })
    expect(lock).toBeTruthy()
  })
})
