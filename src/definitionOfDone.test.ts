import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createLocalAdapter } from './data/adapters/local/LocalAdapter'
import type { DataPort } from './data/ports'
import { instantiateTemplate } from './domain/coa'
import { dryRunImport, parseDelimited } from './domain/importer'
import { PARTY_IMPORT_SPEC } from './domain/importSpecs'
import { trialBalance } from './domain/ledger'
import { blockersPass, lockPeriod, validatePeriodClose, assertPostingAllowed } from './domain/periodClose'
import { postSheetDocument } from './domain/postingService'
import { resolveProfile } from './domain/profileResolution'
import type { Sheet, SheetLine } from './domain/sheets'
import { Money } from './lib/money'
import { qapDraftCsv, slspDraftCsv } from './reports/attachments/datWriter'
import { buildSalesJournal } from './reports/books'
import { buildIncomeStatement } from './reports/financialStatements'
import {
  build2307Certificates,
  buildQap,
  buildReturn1601C,
  buildReturn1601Q,
  buildReturn1701Q,
  buildReturn2550Q,
  buildSlsp,
} from './reports/returns/build'
import type { GeneratedReturn, ReturnContext } from './reports/returns/context'
import { availableForms } from './reports/returns/registry'
import { coaTemplateForProfile } from './seed/coaTemplates'
import { defaultAnswers } from './ui/onboarding/ProfileQuestionnaire'

/**
 * The definition-of-done flow, scripted end to end over the real adapter:
 * a VAT corporation with payroll keys a quarter, posts everything, ties the
 * trial balance, drills from the income statement to the source invoice,
 * renders the sales journal, generates the quarter's VAT and withholding
 * returns with attachments, closes and locks the quarter — then an 8%
 * professional sees a completely different set of forms. All offline.
 */

const NOW = '2026-04-01T00:00:00Z'

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

async function setupCompany(
  port: DataPort,
  id: string,
  name: string,
  answers: ReturnType<typeof defaultAnswers>,
) {
  const company = {
    id,
    tin: { base: '007111222', branchCode: '000' },
    registeredName: name,
    businessStyle: name,
    registeredAddress: 'Makati City',
    createdAt: NOW,
  }
  await port.companies.save(company)
  const profile = resolveProfile(answers)
  await port.taxProfiles.save(id, profile)
  const accounts = instantiateTemplate(id, coaTemplateForProfile(profile))
  await port.accounts.saveMany(accounts)
  return { company, profile, accounts }
}

describe('definition of done — one sitting, fresh browser, no Supabase', () => {
  it('VAT corporation with payroll: import → key a quarter → post → tie → drill → journal → returns → close', async () => {
    const port = createLocalAdapter('dod-vat-corp')
    const { company, profile, accounts } = await setupCompany(
      port,
      'dod-corp',
      'Molave Manufacturing Corp.',
      {
        ...defaultAnswers('2026-01-01'),
        entityType: 'domestic_corporation',
        incomeTaxRegime: 'rcit',
        businessTaxRegime: 'vat',
        hasEmployees: true,
        withholdsExpanded: true,
        accountingBasis: 'accrual',
        fiscalYearEndMonth: 12,
        expectedAnnualGrossCentavos: 2_000_000_000,
        startOfOperations: '2020-01-01',
        rdoCode: '049',
      },
    )
    expect(profile.registeredTaxTypes.has('vat')).toBe(true)
    expect(profile.withholdingAgent.compensation).toBe(true)

    // ---- Import customers and suppliers from pasted TSV ----
    const pasted = parseDelimited(
      [
        'name\ttin\trole\tclass',
        'Mabuhay Retail Inc.\t201-234-567-000\tcustomer\tcorporation',
        'BGC Property Holdings\t301-234-567-000\tsupplier\tcorporation',
      ].join('\n'),
    )
    const imported = dryRunImport(
      PARTY_IMPORT_SPEC,
      pasted,
      { registeredName: 0, tin: 1, role: 2, payeeClass: 3 },
      { companyId: company.id },
    )
    expect(imported.errors).toHaveLength(0)
    for (const p of imported.valid) await port.parties.save(p)
    const parties = await port.parties.list(company.id)
    const customer = parties.find((p) => p.isCustomer)!
    const supplier = parties.find((p) => p.isSupplier)!

    await port.employees.save({
      id: 'dod-emp-1',
      companyId: company.id,
      employeeNo: 'E-001',
      tin: { base: '101222333', branchCode: '000' },
      registeredName: 'Santos, Maria',
      businessStyle: '',
      registeredAddress: 'QC',
      firstName: 'Maria',
      lastName: 'Santos',
      middleName: null,
      hireDate: '2024-05-01',
      separationDate: null,
      monthlyBasicPayCentavos: 4_500_000,
      sssNo: null,
      philhealthNo: null,
      pagibigNo: null,
      active: true,
    })

    await port.numbering.save({
      id: 'dod-ns-si',
      companyId: company.id,
      documentType: 'sales_invoice',
      prefix: 'SI-',
      padding: 4,
      nextNumber: 1,
      authorityRef: null,
    })

    // ---- Key a quarter: sales, purchases, payroll ----
    const mkSheet = (partial: Partial<Sheet> & Pick<Sheet, 'id' | 'type' | 'date' | 'lines'>): Sheet => ({
      companyId: company.id,
      documentNo: '',
      partyId: null,
      memo: '',
      status: 'draft',
      postedEntryId: null,
      bankAccountCode: null,
      payrollPeriod: null,
      ...partial,
    })

    const docs: Sheet[] = [
      mkSheet({
        id: 'dod-si-1',
        type: 'sales_invoice',
        date: '2026-01-20',
        partyId: customer.id,
        lines: [line({ description: 'Fabricated racks', amountCentavos: 56_000_000 })], // 500k + 60k VAT
      }),
      mkSheet({
        id: 'dod-si-2',
        type: 'sales_invoice',
        date: '2026-02-14',
        partyId: customer.id,
        lines: [
          line({ description: 'Shelving units', amountCentavos: 33_600_000 }), // 300k + 36k
          line({ lineNo: 2, description: 'Exempt agricultural produce', amountCentavos: 5_000_000, vatClass: 'exempt' }),
        ],
      }),
      mkSheet({
        id: 'dod-pb-1',
        type: 'purchase_bill',
        documentNo: 'PB-0001',
        date: '2026-02-01',
        partyId: supplier.id,
        lines: [line({ description: 'Warehouse rent — Feb', accountCode: '5300', amountCentavos: 22_400_000, atc: 'WC100' })], // 200k + 24k VAT, EWT 10k
      }),
      mkSheet({
        id: 'dod-pr-1',
        type: 'payroll_register',
        documentNo: 'PR-2026-03',
        date: '2026-03-31',
        payrollPeriod: { from: '2026-03-01', to: '2026-03-31' },
        lines: [
          line({
            description: 'Santos, Maria',
            employeeId: 'dod-emp-1',
            amountCentavos: 4_500_000,
            vatClass: 'exempt',
            payroll: {
              otherTaxableCentavos: 0,
              thirteenthMonthCentavos: 0,
              deMinimisCentavos: 0,
              mandatoryContributionsCentavos: 200_000,
            },
          }),
        ],
      }),
    ]

    for (const s of docs) {
      await port.sheets.saveDraft(s)
      await postSheetDocument(port, {
        sheet: s,
        profile,
        accounts,
        party: parties.find((p) => p.id === s.partyId) ?? null,
        locks: [],
        now: NOW,
        seriesId: s.type === 'sales_invoice' ? 'dod-ns-si' : null,
      })
    }

    const sheets = await port.sheets.list(company.id)
    expect(sheets.every((s) => s.status === 'posted')).toBe(true)
    // Numbers came from the series at post time.
    expect(sheets.filter((s) => s.type === 'sales_invoice').map((s) => s.documentNo).sort()).toEqual([
      'SI-0001',
      'SI-0002',
    ])

    // ---- Trial balance ties ----
    const entries = await port.journal.list(company.id)
    const tb = trialBalance(entries, accounts, '2026-03-31')
    expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true)
    expect(tb.totalDebit.isZero()).toBe(false)

    // ---- Drill from the income statement into the source invoice ----
    const is = buildIncomeStatement(entries, accounts, '2026-01-01', '2026-03-31')
    expect(is.totalIncome.format()).toBe('850,000.00') // 500k + 300k + 50k exempt
    const salesEntryLines = entries.filter(
      (e) => e.date >= '2026-01-01' && e.lines.some((l) => l.accountCode === '4100'),
    )
    const sourceSheetIds = salesEntryLines.map((e) => e.sheetId)
    expect(sourceSheetIds).toContain('dod-si-1') // the figure links back to its invoice

    // ---- Sales journal renders ----
    const sj = buildSalesJournal(entries, sheets, parties, { from: '2026-01-01', to: '2026-03-31' })
    expect(sj).toHaveLength(2)
    expect(sj[0]!.documentNo).toBe('SI-0001')

    // ---- Generate the quarter's returns with attachments ----
    const ctx: ReturnContext = {
      company,
      profile,
      entries,
      sheets,
      parties,
      employees: await port.employees.list(company.id),
      accounts,
      customAtcRates: [],
      priorReturns: [],
    }
    const q = { from: '2026-01-01', to: '2026-03-31' }

    const vat = buildReturn2550Q(ctx, q.from, q.to)
    expect(vat.model.vatableSales.format()).toBe('800,000.00')
    expect(vat.model.outputVat.format()).toBe('96,000.00')
    expect(vat.model.inputVatCurrent.format()).toBe('24,000.00')
    expect(vat.model.netVatPayable.format()).toBe('72,000.00')
    const slsp = buildSlsp(ctx, q.from, q.to)
    expect(slspDraftCsv(slsp).content).toContain('Mabuhay Retail Inc.')

    const ewt = buildReturn1601Q(ctx, q.from, q.to, 'EQ')
    expect(ewt.model.totalTaxWithheld.format()).toBe('10,000.00') // 5% of 200k rent
    expect(qapDraftCsv(buildQap(ctx, q.from, q.to, 'EQ')).content).toContain('BGC Property Holdings')
    const certs = build2307Certificates(ctx, { year: 2026, month: 1 })
    expect(certs).toHaveLength(1)
    expect(certs[0]!.totalWithheld.format()).toBe('10,000.00')

    const comp = buildReturn1601C(ctx, '2026-03-01', '2026-03-31')
    expect(comp.model.taxableCompensation.format()).toBe('43,000.00') // 45k − 2k contributions
    expect(comp.model.taxWithheld.isZero()).toBe(false)

    // Record the generated returns so close and carry-forward see them.
    const record = async (formCode: string, figures: Record<string, number>, periodTo: string, periodFrom: string) => {
      const g: GeneratedReturn = {
        id: `${company.id}:${formCode}:${periodTo}`,
        companyId: company.id,
        formCode,
        periodFrom,
        periodTo,
        generatedAt: NOW,
        figures,
      }
      await port.generatedReturns.save(g)
    }
    await record('2550Q', vat.figures, q.to, q.from)
    await record('1601-EQ', ewt.figures, q.to, q.from)
    await record('1601-C', comp.figures, '2026-03-31', '2026-03-01')
    await record('1702Q', buildReturn1701Q(ctx, q.from, q.to).figures, q.to, q.from)
    await record('0619-E', {}, '2026-01-31', '2026-01-01')
    await record('0619-E', {}, '2026-02-28', '2026-02-01')
    await record('1601-C', {}, '2026-01-31', '2026-01-01')
    await record('1601-C', {}, '2026-02-28', '2026-02-01')

    // ---- Close and lock the quarter, month by month ----
    for (const month of [1, 2, 3]) {
      const input = {
        period: { year: 2026, month },
        profile,
        sheets: await port.sheets.list(company.id),
        entries,
        accounts,
        locks: await port.periodLocks.list(company.id),
        generatedReturns: await port.generatedReturns.list(company.id),
      }
      const checks = validatePeriodClose(input)
      expect(blockersPass(checks), `month ${month}: ${JSON.stringify(checks.filter((c) => !c.passed))}`).toBe(true)
      const lock = lockPeriod({ ...input, companyId: company.id, lockedBy: 'dod', now: NOW })
      await port.periodLocks.append(lock)
    }
    const locks = await port.periodLocks.list(company.id)
    expect(locks.map((l) => l.periodKey).sort()).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(() => assertPostingAllowed('2026-02-15', locks)).toThrow(/locked/)

    // The audit trail recorded the whole story.
    const audit = await port.audit.list(company.id)
    expect(audit.some((a) => a.action === 'sheet_posted')).toBe(true)
  })

  it('8% non-VAT professional: completely different forms, no VAT anywhere', async () => {
    const port = createLocalAdapter('dod-professional')
    const { company, profile, accounts } = await setupCompany(port, 'dod-prof', 'Dr. Ana Lim', {
      ...defaultAnswers('2026-01-01'),
      entityType: 'self_employed_professional',
      incomeTaxRegime: 'eight_percent',
      businessTaxRegime: 'non_vat_percentage',
      accountingBasis: 'cash',
      expectedAnnualGrossCentavos: 150_000_000,
      rdoCode: '039',
    })

    // The chart has no VAT accounts at all.
    expect(accounts.some((a) => a.taxTag === 'output_vat' || a.taxTag === 'input_vat')).toBe(false)

    // The form set is disjoint from the corporation's on every VAT/EWT form.
    const forms = availableForms(profile).map((f) => f.formCode)
    expect(forms).toContain('1701Q')
    expect(forms).toContain('1701A')
    expect(forms).not.toContain('2550Q')
    expect(forms).not.toContain('2551Q') // suppressed by the 8% election
    expect(forms).not.toContain('1601-C')
    expect(forms).not.toContain('1702Q')

    // Key and post a receipt: no VAT is ever derived.
    const receipt: Sheet = {
      id: 'dod-or-1',
      companyId: company.id,
      type: 'sales_receipt',
      documentNo: 'OR-0001',
      date: '2026-01-25',
      partyId: null,
      memo: '',
      lines: [line({ description: 'Professional fees', amountCentavos: 20_000_000 })],
      status: 'draft',
      postedEntryId: null,
      bankAccountCode: null,
      payrollPeriod: null,
    }
    await port.sheets.saveDraft(receipt)
    const { entry } = await postSheetDocument(port, {
      sheet: receipt,
      profile,
      accounts,
      party: null,
      locks: [],
      now: NOW,
      seriesId: null,
    })
    expect(entry.lines.some((l) => l.taxTag === 'output_vat')).toBe(false)

    // 1701Q at 8%: (200,000 − 250,000) → still within the annual exemption.
    const ctx: ReturnContext = {
      company,
      profile,
      entries: await port.journal.list(company.id),
      sheets: await port.sheets.list(company.id),
      parties: [],
      employees: [],
      accounts,
      customAtcRates: [],
      priorReturns: [],
    }
    const q1 = buildReturn1701Q(ctx, '2026-01-01', '2026-03-31')
    expect(q1.model.method).toBe('eight_percent')
    expect(q1.model.grossReceipts.format()).toBe('200,000.00')
    expect(q1.model.taxDueToDate.isZero()).toBe(true) // still inside the ₱250k exemption
    expect(Money.fromCentavos(200_000_00).format()).toBe('200,000.00')
  })
})
