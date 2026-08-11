import type { Company, DataPort } from '../data/ports'
import { instantiateTemplate } from '../domain/coa'
import { tin } from '../domain/core'
import type { Party } from '../domain/masterData'
import { indexAccounts, postSheet } from '../domain/posting'
import type { Sheet, SheetLine } from '../domain/sheets'
import type { TaxProfile } from '../domain/taxProfile'
import { coaTemplateForProfile } from './coaTemplates'
import {
  EIGHT_PERCENT_PROFESSIONAL_PROFILE,
  PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
  VAT_CORPORATION_PROFILE,
} from './profiles'

/**
 * Demo companies covering three visibly different tax profiles:
 *  1. Narra Trading Corp.  — VAT domestic corporation with payroll (RCIT)
 *  2. Dr. Bea Reyes        — 8% self-employed professional, non-VAT
 *  3. Aling Nena's Store   — percentage-tax sole proprietor on OSD
 * Deterministic ids; seeding is idempotent (skips companies that exist).
 */

interface DemoTxn {
  readonly sheet: Omit<Sheet, 'companyId' | 'status' | 'postedEntryId'>
  readonly partyId: string | null
}

interface DemoCompany {
  readonly company: Company
  readonly profile: TaxProfile
  readonly parties: readonly Omit<Party, 'companyId'>[]
  readonly txns: readonly DemoTxn[]
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

const sheetBase = {
  memo: '',
  bankAccountCode: null,
  payrollPeriod: null,
} as const

const DEMOS: readonly DemoCompany[] = [
  {
    company: {
      id: 'demo-narra',
      tin: tin('007654321'),
      registeredName: 'Narra Trading Corporation',
      businessStyle: 'Narra Trading',
      registeredAddress: '18F Ayala Ave., Makati City',
      createdAt: '2026-01-01T00:00:00Z',
    },
    profile: VAT_CORPORATION_PROFILE,
    parties: [
      {
        id: 'demo-narra-cust1',
        tin: tin('201234567'),
        registeredName: 'Mabuhay Retail Inc.',
        businessStyle: 'Mabuhay',
        registeredAddress: 'Pasig City',
        isCustomer: true,
        isSupplier: false,
        payeeClass: 'corporation',
        isGovernment: false,
        defaultAtc: null,
        active: true,
      },
      {
        id: 'demo-narra-supp1',
        tin: tin('301234567'),
        registeredName: 'Bonifacio Property Holdings Corp.',
        businessStyle: 'BPH',
        registeredAddress: 'Taguig City',
        isCustomer: false,
        isSupplier: true,
        payeeClass: 'corporation',
        isGovernment: false,
        defaultAtc: 'WC100',
        active: true,
      },
    ],
    txns: [
      {
        partyId: 'demo-narra-cust1',
        sheet: {
          ...sheetBase,
          id: 'demo-narra-si1',
          type: 'sales_invoice',
          documentNo: 'SI-0001',
          date: '2026-01-15',
          partyId: 'demo-narra-cust1',
          lines: [
            line({ description: 'Office furniture — 20 units', amountCentavos: 44_800_000 }),
            line({ lineNo: 2, description: 'Books (VAT-exempt)', amountCentavos: 5_000_000, vatClass: 'exempt' }),
          ],
        },
      },
      {
        partyId: 'demo-narra-supp1',
        sheet: {
          ...sheetBase,
          id: 'demo-narra-pb1',
          type: 'purchase_bill',
          documentNo: 'PB-0001',
          date: '2026-01-31',
          partyId: 'demo-narra-supp1',
          lines: [
            line({ description: 'Office rent — January', accountCode: '5300', amountCentavos: 11_200_000, atc: 'WC100' }),
          ],
        },
      },
      {
        partyId: null,
        sheet: {
          ...sheetBase,
          id: 'demo-narra-pr1',
          type: 'payroll_register',
          documentNo: 'PR-2026-01',
          date: '2026-01-31',
          partyId: null,
          payrollPeriod: { from: '2026-01-01', to: '2026-01-31' },
          lines: [
            line({ description: 'Dela Cruz, Juan — Warehouse Lead', amountCentavos: 3_500_000, vatClass: 'exempt' }),
            line({ lineNo: 2, description: 'Santos, Maria — Accountant', amountCentavos: 6_000_000, vatClass: 'exempt' }),
          ],
        },
      },
      {
        partyId: 'demo-narra-cust1',
        sheet: {
          ...sheetBase,
          id: 'demo-narra-col1',
          type: 'collection',
          documentNo: 'CR-0001',
          date: '2026-02-05',
          partyId: 'demo-narra-cust1',
          lines: [line({ description: 'Partial collection SI-0001', amountCentavos: 30_000_000 })],
        },
      },
    ],
  },
  {
    company: {
      id: 'demo-reyes',
      tin: tin('123987654'),
      registeredName: 'Reyes, Bea Alonzo',
      businessStyle: 'Reyes Dental Clinic',
      registeredAddress: 'Katipunan Ave., Quezon City',
      createdAt: '2026-01-01T00:00:00Z',
    },
    profile: EIGHT_PERCENT_PROFESSIONAL_PROFILE,
    parties: [
      {
        id: 'demo-reyes-cust1',
        tin: tin('208765432'),
        registeredName: 'HealthFirst HMO, Inc.',
        businessStyle: 'HealthFirst',
        registeredAddress: 'Ortigas Center, Pasig',
        isCustomer: true,
        isSupplier: false,
        payeeClass: 'corporation',
        isGovernment: false,
        defaultAtc: null,
        active: true,
      },
    ],
    txns: [
      {
        partyId: 'demo-reyes-cust1',
        sheet: {
          ...sheetBase,
          id: 'demo-reyes-sr1',
          type: 'sales_receipt',
          documentNo: 'OR-0101',
          date: '2026-01-20',
          partyId: 'demo-reyes-cust1',
          lines: [line({ description: 'Professional fees — HMO patients, January', amountCentavos: 18_000_000 })],
        },
      },
      {
        partyId: null,
        sheet: {
          ...sheetBase,
          id: 'demo-reyes-pb1',
          type: 'purchase_bill',
          documentNo: 'PB-0001',
          date: '2026-01-25',
          partyId: null,
          lines: [
            line({ description: 'Dental supplies', accountCode: '5600', amountCentavos: 3_360_000 }),
          ],
        },
      },
    ],
  },
  {
    company: {
      id: 'demo-nena',
      tin: tin('456123789'),
      registeredName: 'Villanueva, Nena Cruz',
      businessStyle: "Aling Nena's Sari-Sari Store",
      registeredAddress: 'Bacoor, Cavite',
      createdAt: '2026-01-01T00:00:00Z',
    },
    profile: PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE,
    parties: [
      {
        id: 'demo-nena-supp1',
        tin: tin('309876543'),
        registeredName: 'Imus Commercial Properties',
        businessStyle: 'ICP',
        registeredAddress: 'Imus, Cavite',
        isCustomer: false,
        isSupplier: true,
        payeeClass: 'individual',
        isGovernment: false,
        defaultAtc: 'WI100',
        active: true,
      },
    ],
    txns: [
      {
        partyId: null,
        sheet: {
          ...sheetBase,
          id: 'demo-nena-si1',
          type: 'sales_invoice',
          documentNo: 'SI-0001',
          date: '2026-01-10',
          partyId: null,
          lines: [line({ description: 'Store sales — first half of January', amountCentavos: 9_500_000 })],
        },
      },
      {
        partyId: 'demo-nena-supp1',
        sheet: {
          ...sheetBase,
          id: 'demo-nena-pb1',
          type: 'purchase_bill',
          documentNo: 'PB-0001',
          date: '2026-01-31',
          partyId: 'demo-nena-supp1',
          lines: [
            line({ description: 'Stall rent — January', accountCode: '5300', amountCentavos: 1_500_000, atc: 'WI100' }),
          ],
        },
      },
    ],
  },
]

export async function seedDemoData(port: DataPort): Promise<{ seeded: string[] }> {
  const seeded: string[] = []
  for (const demo of DEMOS) {
    if (await port.companies.get(demo.company.id)) continue

    await port.companies.save(demo.company)
    await port.taxProfiles.save(demo.company.id, demo.profile)

    const accounts = instantiateTemplate(demo.company.id, coaTemplateForProfile(demo.profile))
    await port.accounts.saveMany(accounts)
    const idx = indexAccounts(accounts)

    const parties: Party[] = demo.parties.map((p) => ({ ...p, companyId: demo.company.id }))
    for (const p of parties) await port.parties.save(p)

    for (const docType of ['sales_invoice', 'sales_receipt', 'purchase_bill'] as const) {
      await port.numbering.save({
        id: `${demo.company.id}-ns-${docType}`,
        companyId: demo.company.id,
        documentType: docType,
        prefix: docType === 'purchase_bill' ? 'PB-' : docType === 'sales_receipt' ? 'OR-' : 'SI-',
        padding: 4,
        nextNumber: 1000,
        authorityRef: null,
      })
    }

    let entryNo = 1
    for (const txn of demo.txns) {
      const sheet: Sheet = {
        ...txn.sheet,
        companyId: demo.company.id,
        status: 'draft',
        postedEntryId: null,
      }
      await port.sheets.saveDraft(sheet)
      const entry = postSheet(sheet, {
        profile: demo.profile,
        accounts: idx,
        party: parties.find((p) => p.id === txn.partyId) ?? null,
        entryId: `${demo.company.id}-je-${entryNo}`,
        entryNo,
        postedAt: `${sheet.date}T08:00:00Z`,
      })
      await port.journal.append(entry)
      await port.sheets.markPosted(sheet.id, entry.id)
      entryNo += 1
    }
    seeded.push(demo.company.registeredName)
  }
  return { seeded }
}

export const DEMO_COMPANY_IDS = DEMOS.map((d) => d.company.id)
