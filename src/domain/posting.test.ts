import { describe, expect, it } from 'vitest'
import { Money } from '../lib/money'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  VAT_CORPORATION_PROFILE,
} from '../seed/profiles'
import { STANDARD_PH_COA } from '../seed/coaTemplates'
import { instantiateTemplate } from './coa'
import { trialBalance } from './ledger'
import type { Party } from './masterData'
import { lockPeriod, PeriodLockedError, assertPostingAllowed, validatePeriodClose } from './periodClose'
import { indexAccounts, postSheet, PostingError, type PostingContext } from './posting'
import type { Sheet, SheetLine } from './sheets'

const accounts = instantiateTemplate('co-1', STANDARD_PH_COA)
const idx = indexAccounts(accounts)

const customer: Party = {
  id: 'p-1',
  companyId: 'co-1',
  tin: { base: '123456789', branchCode: '000' },
  registeredName: 'Acme Corp.',
  businessStyle: 'Acme',
  registeredAddress: 'Makati City',
  isCustomer: true,
  isSupplier: false,
  payeeClass: 'corporation',
  isGovernment: false,
  defaultAtc: null,
  active: true,
}

const line = (overrides: Partial<SheetLine>): SheetLine => ({
  lineNo: 1,
  description: 'line',
  accountCode: null,
  itemId: null,
  quantity: null,
  amountCentavos: 1_120_000, // ₱11,200
  amountIsVatInclusive: true,
  vatClass: 'vatable',
  atc: null,
  side: null,
  ...overrides,
})

const sheet = (overrides: Partial<Sheet>): Sheet => ({
  id: 's-1',
  companyId: 'co-1',
  type: 'sales_invoice',
  documentNo: 'SI-0001',
  date: '2026-03-15',
  partyId: 'p-1',
  memo: '',
  lines: [line({})],
  status: 'draft',
  postedEntryId: null,
  bankAccountCode: null,
  payrollPeriod: null,
  ...overrides,
})

const ctx = (overrides: Partial<PostingContext> = {}): PostingContext => ({
  profile: VAT_CORPORATION_PROFILE,
  accounts: idx,
  party: customer,
  entryId: 'je-1',
  entryNo: 1,
  postedAt: '2026-03-15T08:00:00Z',
  ...overrides,
})

describe('postSheet — sales', () => {
  it('VAT company invoice: AR gross, sales net, output VAT split', () => {
    const e = postSheet(sheet({}), ctx())
    const by = (code: string) => e.lines.find((l) => l.accountCode === code)
    expect(by('1200')?.debitCentavos).toBe(1_120_000)
    expect(by('4100')?.creditCentavos).toBe(1_000_000)
    expect(by('2200')?.creditCentavos).toBe(120_000)
  })

  it('non-VAT professional receipt: no VAT anywhere, cash at gross', () => {
    const e = postSheet(
      sheet({ type: 'sales_receipt', documentNo: 'OR-0001' }),
      ctx({ profile: EIGHT_PERCENT_PROFESSIONAL_PROFILE }),
    )
    expect(e.lines.find((l) => l.accountCode === '2200')).toBeUndefined()
    expect(e.lines.find((l) => l.accountCode === '1100')?.debitCentavos).toBe(1_120_000)
    expect(e.lines.find((l) => l.accountCode === '4100')?.creditCentavos).toBe(1_120_000)
  })

  it('credit memo mirrors the invoice with sides swapped', () => {
    const e = postSheet(sheet({ type: 'credit_memo', documentNo: 'CM-0001' }), ctx())
    expect(e.lines.find((l) => l.accountCode === '1200')?.creditCentavos).toBe(1_120_000)
    expect(e.lines.find((l) => l.accountCode === '4100')?.debitCentavos).toBe(1_000_000)
  })

  it('exempt and zero-rated lines post to their own income accounts', () => {
    const e = postSheet(
      sheet({
        lines: [
          line({}),
          line({ lineNo: 2, vatClass: 'exempt', amountCentavos: 500_000 }),
          line({ lineNo: 3, vatClass: 'zero_rated', amountCentavos: 800_000 }),
        ],
      }),
      ctx(),
    )
    expect(e.lines.find((l) => l.accountCode === '4110')?.creditCentavos).toBe(500_000)
    expect(e.lines.find((l) => l.accountCode === '4120')?.creditCentavos).toBe(800_000)
  })
})

describe('postSheet — purchases', () => {
  it('purchase bill with EWT: expense net, input VAT, EWT payable, AP net of EWT', () => {
    const e = postSheet(
      sheet({
        type: 'purchase_bill',
        documentNo: 'PB-0001',
        lines: [line({ accountCode: '5300', atc: 'WC100' })], // rent, 5%
      }),
      ctx(),
    )
    const by = (code: string) => e.lines.find((l) => l.accountCode === code)
    expect(by('5300')?.debitCentavos).toBe(1_000_000)
    expect(by('1400')?.debitCentavos).toBe(120_000)
    expect(by('2300')?.creditCentavos).toBe(50_000) // 5% of 10,000 net
    expect(by('2100')?.creditCentavos).toBe(1_070_000)
  })

  it('non-VAT buyer books gross as cost but still withholds on the net base', () => {
    const e = postSheet(
      sheet({
        type: 'purchase_bill',
        lines: [line({ accountCode: '5300', atc: 'WC100' })],
      }),
      ctx({
        profile: {
          ...EIGHT_PERCENT_PROFESSIONAL_PROFILE,
          registeredTaxTypes: new Set(['income_tax', 'percentage_tax', 'withholding_expanded']),
          withholdingAgent: { ...EIGHT_PERCENT_PROFESSIONAL_PROFILE.withholdingAgent, expanded: true },
        },
      }),
    )
    const by = (code: string) => e.lines.find((l) => l.accountCode === code)
    expect(by('5300')?.debitCentavos).toBe(1_120_000) // gross is cost
    expect(by('1400')).toBeUndefined() // no creditable input VAT
    expect(by('2300')?.creditCentavos).toBe(50_000) // EWT still on ₱10,000 net
  })
})

describe('postSheet — payroll', () => {
  it('posts gross salaries, compensation withholding, and net payable', () => {
    const e = postSheet(
      sheet({
        type: 'payroll_register',
        documentNo: 'PR-2026-03',
        partyId: null,
        payrollPeriod: { from: '2026-03-01', to: '2026-03-31' },
        lines: [
          line({ description: 'Juan Dela Cruz', amountCentavos: 3_000_000, vatClass: 'exempt' }),
          line({ lineNo: 2, description: 'Maria Santos', amountCentavos: 8_000_000, vatClass: 'exempt' }),
        ],
      }),
      ctx({ party: null }),
    )
    const by = (code: string) => e.lines.find((l) => l.accountCode === code)
    expect(by('5200')?.debitCentavos).toBe(11_000_000)
    // 30,000 → 1,375.05 ; 80,000 → 11,875.05
    expect(by('2320')?.creditCentavos).toBe(137_505 + 1_187_505)
    expect(by('2500')?.creditCentavos).toBe(11_000_000 - 137_505 - 1_187_505)
  })
})

describe('postSheet — guards', () => {
  it('refuses to post a non-draft sheet', () => {
    expect(() => postSheet(sheet({ status: 'posted' }), ctx())).toThrow(PostingError)
  })

  it('refuses an empty sheet', () => {
    expect(() => postSheet(sheet({ lines: [] }), ctx())).toThrow(PostingError)
  })
})

describe('trial balance ties by construction', () => {
  it('over a mixed batch of posted sheets', () => {
    const posted = [
      postSheet(sheet({}), ctx()),
      postSheet(
        sheet({ id: 's-2', type: 'purchase_bill', lines: [line({ accountCode: '5400', atc: 'WC010' })] }),
        ctx({ entryId: 'je-2', entryNo: 2 }),
      ),
      postSheet(
        sheet({ id: 's-3', type: 'collection', lines: [line({ amountCentavos: 500_000 })] }),
        ctx({ entryId: 'je-3', entryNo: 3 }),
      ),
      postSheet(
        sheet({
          id: 's-4',
          type: 'general_journal',
          lines: [
            line({ accountCode: '5800', side: 'debit', amountCentavos: 42_42 }),
            line({ lineNo: 2, accountCode: '1500', side: 'credit', amountCentavos: 42_42 }),
          ],
        }),
        ctx({ entryId: 'je-4', entryNo: 4 }),
      ),
    ]
    const tb = trialBalance(posted, accounts, '2026-12-31')
    expect(tb.totalDebit.centavos).toBeGreaterThan(0)
    expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true)
  })
})

describe('period close', () => {
  const postedSheet = sheet({ status: 'posted', postedEntryId: 'je-1' })
  const entry = postSheet(sheet({}), ctx())

  it('blocks locking while drafts remain, then locks and blocks posting', () => {
    const draft = sheet({ id: 's-9', documentNo: 'SI-0009' })
    const failing = validatePeriodClose({
      period: { year: 2026, month: 3 },
      profile: null,
      sheets: [postedSheet, draft],
      entries: [entry],
      accounts,
      locks: [],
      generatedReturns: [],
    })
    expect(failing.find((c) => c.id === 'no_draft_sheets')?.passed).toBe(false)

    const lock = lockPeriod({
      companyId: 'co-1',
      period: { year: 2026, month: 3 },
      profile: null,
      sheets: [postedSheet],
      entries: [entry],
      accounts,
      locks: [],
      generatedReturns: [],
      lockedBy: 'tester',
      now: '2026-04-05T00:00:00Z',
    })
    expect(lock.periodKey).toBe('2026-03')
    expect(() => assertPostingAllowed('2026-03-20', [lock])).toThrow(PeriodLockedError)
    expect(() => assertPostingAllowed('2026-04-01', [lock])).not.toThrow()
  })
})
