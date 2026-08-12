import { describe, expect, it } from 'vitest'
import type { Company } from '../../data/ports'
import { instantiateTemplate } from '../../domain/coa'
import { tin } from '../../domain/core'
import type { Party } from '../../domain/masterData'
import { indexAccounts, postSheet } from '../../domain/posting'
import type { Sheet, SheetLine } from '../../domain/sheets'
import type { JournalEntry } from '../../domain/journal'
import { coaTemplateForProfile } from '../../seed/coaTemplates'
import { VAT_CORPORATION_PROFILE } from '../../seed/profiles'
import {
  build2307Certificates,
  build2316Certificates,
  buildReturn1601C,
  buildReturn1601Q,
  buildReturn2550Q,
  buildSlsp,
} from './build'
import type { ReturnContext } from './context'

/**
 * End-to-end return building over real posted sheets: post documents through
 * the actual posting engine, then assert the returns and certificates that
 * fall out.
 */

const company: Company = {
  id: 'co-t',
  tin: tin('001234567'),
  registeredName: 'Test Corp',
  businessStyle: 'Test',
  registeredAddress: 'Makati',
  createdAt: '2026-01-01T00:00:00Z',
}

const customer: Party = {
  id: 'cust-1',
  companyId: 'co-t',
  tin: tin('201111111'),
  registeredName: 'Buyer Inc.',
  businessStyle: '',
  registeredAddress: 'Pasig',
  isCustomer: true,
  isSupplier: false,
  payeeClass: 'corporation',
  isGovernment: false,
  defaultAtc: null,
  mergedIntoId: null,
  active: true,
}

const landlord: Party = {
  ...customer,
  id: 'supp-1',
  registeredName: 'Landlord Corp.',
  tin: tin('301111111'),
  isCustomer: false,
  isSupplier: true,
  defaultAtc: 'WC100',
}

const line = (o: Partial<SheetLine> & { amountCentavos: number }): SheetLine => ({
  lineNo: 1,
  description: '',
  accountCode: null,
  itemId: null,
  quantity: null,
  amountIsVatInclusive: true,
  vatClass: 'vatable',
  atc: null,
  side: null,
  ...o,
})

function makeContext(): ReturnContext {
  const accounts = instantiateTemplate('co-t', coaTemplateForProfile(VAT_CORPORATION_PROFILE))
  const idx = indexAccounts(accounts)
  const sheets: Sheet[] = []
  const entries: JournalEntry[] = []
  let n = 0
  const post = (partial: Omit<Sheet, 'companyId' | 'status' | 'postedEntryId' | 'memo' | 'bankAccountCode' | 'payrollPeriod'>, party: Party | null) => {
    n += 1
    const sheet: Sheet = {
      ...partial,
      companyId: 'co-t',
      status: 'draft',
      postedEntryId: null,
      memo: '',
      bankAccountCode: null,
      payrollPeriod: partial.type === 'payroll_register' ? { from: partial.date, to: partial.date } : null,
    }
    const entry = postSheet(sheet, {
      profile: VAT_CORPORATION_PROFILE,
      accounts: idx,
      party,
      entryId: `e${n}`,
      entryNo: n,
      postedAt: `${partial.date}T00:00:00Z`,
    })
    sheets.push({ ...sheet, status: 'posted', postedEntryId: entry.id })
    entries.push(entry)
  }

  // Q1 2026: one mixed sales invoice, one rent bill with EWT, one payroll run.
  post(
    {
      id: 's1',
      type: 'sales_invoice',
      documentNo: 'SI-1',
      date: '2026-01-15',
      partyId: 'cust-1',
      lines: [
        line({ description: 'Goods', amountCentavos: 44_800_000 }), // net 400k + VAT 48k
        line({ lineNo: 2, description: 'Books', amountCentavos: 5_000_000, vatClass: 'exempt' }),
      ],
    },
    customer,
  )
  post(
    {
      id: 's2',
      type: 'purchase_bill',
      documentNo: 'PB-1',
      date: '2026-02-10',
      partyId: 'supp-1',
      lines: [line({ description: 'Rent Feb', accountCode: '5300', amountCentavos: 11_200_000, atc: 'WC100' })],
    },
    landlord,
  )
  post(
    {
      id: 's3',
      type: 'payroll_register',
      documentNo: 'PR-1',
      date: '2026-01-31',
      partyId: null,
      lines: [
        line({ description: 'Cruz, Juan', employeeId: 'emp-1', amountCentavos: 4_000_000, vatClass: 'exempt' }),
      ],
    },
    null,
  )

  return {
    company,
    profile: VAT_CORPORATION_PROFILE,
    entries,
    sheets,
    parties: [customer, landlord],
    employees: [
      {
        id: 'emp-1',
        companyId: 'co-t',
        employeeNo: 'E-1',
        tin: tin('101111111'),
        registeredName: 'Cruz, Juan',
        businessStyle: '',
        registeredAddress: 'QC',
        firstName: 'Juan',
        lastName: 'Cruz',
        middleName: null,
        hireDate: '2024-01-01',
        separationDate: null,
        monthlyBasicPayCentavos: 4_000_000,
        sssNo: null,
        philhealthNo: null,
        pagibigNo: null,
        active: true,
      },
    ],
    accounts,
    customAtcRates: [],
    priorReturns: [],
  }
}

const Q1 = { from: '2026-01-01', to: '2026-03-31' }

describe('buildReturn2550Q', () => {
  it('maps sales, output VAT, input VAT, and the payable onto the form', () => {
    const { model } = buildReturn2550Q(makeContext(), Q1.from, Q1.to)
    expect(model.vatableSales.format()).toBe('400,000.00')
    expect(model.exemptSales.format()).toBe('50,000.00')
    expect(model.outputVat.format()).toBe('48,000.00')
    expect(model.inputVatCurrent.format()).toBe('12,000.00') // rent 112k inc → 12k VAT
    expect(model.netVatPayable.format()).toBe('36,000.00')
    expect(model.excessInputVatCarryForward.isZero()).toBe(true)
  })

  it('applies the prior quarter excess as carried-over input VAT', () => {
    const ctx: ReturnContext = {
      ...makeContext(),
      priorReturns: [
        {
          id: 'co-t:2550Q:2025-12-31',
          companyId: 'co-t',
          formCode: '2550Q',
          periodFrom: '2025-10-01',
          periodTo: '2025-12-31',
          generatedAt: '',
          figures: { excessInputVatCarryForward: 2_000_00 },
        },
      ],
    }
    const { model } = buildReturn2550Q(ctx, Q1.from, Q1.to)
    expect(model.inputVatCarriedOver.format()).toBe('2,000.00')
    expect(model.netVatPayable.format()).toBe('34,000.00')
  })

  it('allocates input VAT by sales mix for mixed-transaction profiles', () => {
    const base = makeContext()
    const ctx: ReturnContext = {
      ...base,
      profile: { ...base.profile, hasMixedTransactions: true },
    }
    const { model } = buildReturn2550Q(ctx, Q1.from, Q1.to)
    // Sales mix 400k taxable : 50k exempt → 12,000 × 50/450 to exempt.
    expect(model.inputVatAllocatedToExempt.format()).toBe('1,333.33')
    expect(model.netVatPayable.format()).toBe('37,333.33')
  })
})

describe('buildReturn1601Q (EQ)', () => {
  it('summarizes the quarter per ATC and nets monthly remittances', () => {
    const { model } = buildReturn1601Q(makeContext(), Q1.from, Q1.to, 'EQ')
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]!.atc).toBe('WC100')
    expect(model.rows[0]!.taxBase.format()).toBe('100,000.00')
    expect(model.rows[0]!.taxWithheld.format()).toBe('5,000.00')
    expect(model.totalTaxWithheld.format()).toBe('5,000.00')
    // The rent fell in February (month 2) → already remitted with the 0619-E.
    expect(model.monthlyRemittances.format()).toBe('5,000.00')
    expect(model.netRemittance.isZero()).toBe(true)
  })
})

describe('buildReturn1601C', () => {
  it('recomputes payroll through the engine for the month', () => {
    const { model } = buildReturn1601C(makeContext(), '2026-01-01', '2026-01-31')
    expect(model.totalCompensation.format()).toBe('40,000.00')
    // (40,000 − 33,333) × 20% + 1,875 = 3,208.40
    expect(model.taxWithheld.format()).toBe('3,208.40')
  })
})

describe('certificates', () => {
  it('issues a 2307 to the landlord with month-of-quarter columns', () => {
    const certs = build2307Certificates(makeContext(), { year: 2026, month: 1 })
    expect(certs).toHaveLength(1)
    const c = certs[0]!
    expect(c.payee.registeredName).toBe('Landlord Corp.')
    expect(c.rows[0]!.monthAmounts.map((m) => m.format())).toEqual(['0.00', '100,000.00', '0.00'])
    expect(c.totalWithheld.format()).toBe('5,000.00')
  })

  it('issues a 2316 per employee with the annualized tax due', () => {
    const certs = build2316Certificates(makeContext(), 2026)
    expect(certs).toHaveLength(1)
    expect(certs[0]!.employee.registeredName).toBe('Cruz, Juan')
    expect(certs[0]!.taxWithheld.format()).toBe('3,208.40')
  })
})

describe('corrections and memos', () => {
  it('excludes documents whose entry was reversed from every document-derived figure', () => {
    const ctx = makeContext()
    // Reverse the rent bill's entry: its EWT and input VAT must drop out.
    const original = ctx.entries.find((e) => e.sheetId === 's2')!
    const reversal = {
      ...original,
      id: 'rev-1',
      entryNo: 99,
      reversalOfEntryId: original.id,
      lines: original.lines,
    }
    const withReversal: ReturnContext = { ...ctx, entries: [...ctx.entries, reversal] }
    expect(buildReturn1601Q(withReversal, Q1.from, Q1.to, 'EQ').model.totalTaxWithheld.isZero()).toBe(true)
    expect(buildReturn2550Q(withReversal, Q1.from, Q1.to).model.inputVatCurrent.isZero()).toBe(true)
    expect(build2307Certificates(withReversal, { year: 2026, month: 1 })).toHaveLength(0)
  })

  it('debit memos enter withholding negative, netting the QAP and certificates', () => {
    const base = makeContext()
    const memo: Sheet = {
      id: 's-dm',
      companyId: 'co-t',
      type: 'debit_memo',
      documentNo: 'DM-1',
      date: '2026-02-20',
      partyId: 'supp-1',
      memo: '',
      lines: [line({ description: 'Rent adjustment', accountCode: '5300', amountCentavos: 2_240_000, atc: 'WC100' })],
      status: 'posted',
      postedEntryId: 'dm-entry',
      bankAccountCode: null,
      payrollPeriod: null,
    }
    const ctx: ReturnContext = { ...base, sheets: [...base.sheets, memo] }
    const q = buildReturn1601Q(ctx, Q1.from, Q1.to, 'EQ')
    // 5,000 withheld on the bill − 1,000 reversed by the memo (5% of 20k net).
    expect(q.model.totalTaxWithheld.format()).toBe('4,000.00')
    const certs = build2307Certificates(ctx, { year: 2026, month: 1 })
    expect(certs[0]!.totalWithheld.format()).toBe('4,000.00')
  })
})

describe('buildSlsp', () => {
  it('aggregates sales and purchases per counterparty', () => {
    const slsp = buildSlsp(makeContext(), Q1.from, Q1.to)
    expect(slsp.sales).toHaveLength(1)
    expect(slsp.sales[0]!.taxableNet.format()).toBe('400,000.00')
    expect(slsp.sales[0]!.exemptAmount.format()).toBe('50,000.00')
    expect(slsp.purchases[0]!.vatAmount.format()).toBe('12,000.00')
  })
})
