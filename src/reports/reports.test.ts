import { describe, expect, it } from 'vitest'
import type { Company } from '../data/ports'
import { instantiateTemplate } from '../domain/coa'
import type { Party } from '../domain/masterData'
import { indexAccounts, postSheet, type PostingContext } from '../domain/posting'
import type { Sheet, SheetLine } from '../domain/sheets'
import { STANDARD_PH_COA } from '../seed/coaTemplates'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  VAT_CORPORATION_PROFILE,
} from '../seed/profiles'
import { buildPurchaseJournal, buildSalesJournal } from './books'
import { buildBalanceSheet, buildIncomeStatement } from './financialStatements'
import { build2550Q } from './returns/builders'
import { availableForms } from './returns/registry'
import { stubRenderer } from './returns/models'

const accounts = instantiateTemplate('co-1', STANDARD_PH_COA)
const idx = indexAccounts(accounts)

const company: Company = {
  id: 'co-1',
  tin: { base: '007123456', branchCode: '000' },
  registeredName: 'Narra Trading Corp.',
  businessStyle: 'Narra',
  registeredAddress: 'Makati City',
  createdAt: '2026-01-01T00:00:00Z',
}

const customer: Party = {
  id: 'p-1',
  companyId: 'co-1',
  tin: { base: '123456789', branchCode: '000' },
  registeredName: 'Acme Corp.',
  businessStyle: 'Acme',
  registeredAddress: 'Taguig',
  isCustomer: true,
  isSupplier: true,
  payeeClass: 'corporation',
  isGovernment: false,
  defaultAtc: null,
  active: true,
}

const line = (o: Partial<SheetLine>): SheetLine => ({
  lineNo: 1,
  description: 'line',
  accountCode: null,
  itemId: null,
  quantity: null,
  amountCentavos: 1_120_000,
  amountIsVatInclusive: true,
  vatClass: 'vatable',
  atc: null,
  side: null,
  ...o,
})

const sheet = (o: Partial<Sheet>): Sheet => ({
  id: 's-1',
  companyId: 'co-1',
  type: 'sales_invoice',
  documentNo: 'SI-0001',
  date: '2026-02-10',
  partyId: 'p-1',
  memo: '',
  lines: [line({})],
  status: 'draft',
  postedEntryId: null,
  bankAccountCode: null,
  payrollPeriod: null,
  ...o,
})

const ctx = (o: Partial<PostingContext> = {}): PostingContext => ({
  profile: VAT_CORPORATION_PROFILE,
  accounts: idx,
  party: customer,
  entryId: 'je-1',
  entryNo: 1,
  postedAt: '2026-02-10T08:00:00Z',
  ...o,
})

// One Q1 with a sale (₱11,200 gross) and a purchase (₱5,600 gross, rent ATC).
const saleSheet = sheet({})
const purchaseSheet = sheet({
  id: 's-2',
  type: 'purchase_bill',
  documentNo: 'PB-0001',
  date: '2026-03-05',
  lines: [line({ accountCode: '5300', amountCentavos: 560_000, atc: 'WC100' })],
})
const entries = [
  postSheet(saleSheet, ctx()),
  postSheet(purchaseSheet, ctx({ entryId: 'je-2', entryNo: 2 })),
]
const postedSheets = [
  { ...saleSheet, status: 'posted' as const, postedEntryId: 'je-1' },
  { ...purchaseSheet, status: 'posted' as const, postedEntryId: 'je-2' },
]
const Q1 = { from: '2026-01-01', to: '2026-03-31' }

describe('books of accounts', () => {
  it('sales journal shows the VAT-columnar row', () => {
    const rows = buildSalesJournal(entries, postedSheets, [customer], Q1)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.vatableSales.format()).toBe('10,000.00')
    expect(rows[0]!.outputVat.format()).toBe('1,200.00')
    expect(rows[0]!.total.format()).toBe('11,200.00')
    expect(rows[0]!.customerTin).toBe('123-456-789-000')
  })

  it('purchase journal splits cost, input VAT, and EWT', () => {
    const rows = buildPurchaseJournal(entries, postedSheets, [customer], Q1)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.purchases.format()).toBe('5,000.00')
    expect(rows[0]!.inputVat.format()).toBe('600.00')
    expect(rows[0]!.ewtWithheld.format()).toBe('250.00')
  })
})

describe('financial statements', () => {
  it('income statement nets sales against expenses', () => {
    const is = buildIncomeStatement(entries, accounts, Q1.from, Q1.to)
    expect(is.totalIncome.format()).toBe('10,000.00')
    expect(is.totalExpenses.format()).toBe('5,000.00')
    expect(is.netIncome.format()).toBe('5,000.00')
  })

  it('balance sheet balances with unclosed earnings folded into equity', () => {
    const bs = buildBalanceSheet(entries, accounts, '2026-03-31')
    expect(bs.totalAssets.equals(bs.totalLiabilities.add(bs.totalEquity))).toBe(true)
  })
})

describe('2550Q from the ledger', () => {
  it('fills the VAT return from tagged lines', () => {
    const q = build2550Q(company, VAT_CORPORATION_PROFILE, { entries, ...Q1 })
    expect(q.vatableSales.format()).toBe('10,000.00')
    expect(q.outputVat.format()).toBe('1,200.00')
    expect(q.inputVatCurrent.format()).toBe('600.00')
    expect(q.netVatPayable.format()).toBe('600.00')
    expect(q.header.rdoCode).toBe('049')
  })

  it('stub renderer serializes the typed model', () => {
    const q = build2550Q(company, VAT_CORPORATION_PROFILE, { entries, ...Q1 })
    const rendered = stubRenderer<typeof q>('2550Q').render(q)
    expect(rendered).toContain('"formCode": "2550Q"')
  })
})

describe('form registry derives from the profile', () => {
  it('VAT corporation sees 2550Q but never 2551Q', () => {
    const codes = availableForms(VAT_CORPORATION_PROFILE).map((f) => f.formCode)
    expect(codes).toContain('2550Q')
    expect(codes).toContain('1702-RT')
    expect(codes).toContain('1601-C')
    expect(codes).not.toContain('2551Q')
    expect(codes).not.toContain('1701A')
  })

  it('8% professional sees 1701A/1701Q, never 2550Q or 2551Q', () => {
    const codes = availableForms(EIGHT_PERCENT_PROFESSIONAL_PROFILE).map((f) => f.formCode)
    expect(codes).toContain('1701A')
    expect(codes).toContain('1701Q')
    expect(codes).not.toContain('2550Q')
    expect(codes).not.toContain('2551Q') // suppressed by the 8% election
    expect(codes).not.toContain('1601-C')
  })
})
