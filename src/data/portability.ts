import type { AuditEvent } from '../domain/audit'
import { auditEvent } from '../domain/audit'
import type { Account } from '../domain/coa'
import type { JournalEntry } from '../domain/journal'
import type {
  AtcCode,
  BankAccount,
  Employee,
  Item,
  NumberingSeries,
  Party,
} from '../domain/masterData'
import type { PeriodLock } from '../domain/periodClose'
import type { Sheet } from '../domain/sheets'
import type { TaxProfile } from '../domain/taxProfile'
import type { GeneratedReturn } from '../reports/returns/context'
import type { Company, DataPort } from './ports'

/**
 * Whole-company JSON portability: everything the DataPort holds for one
 * company round-trips through a single bundle, so data can move between
 * browsers (and later to Supabase) without a backend. Sets are stored as
 * arrays; Money never appears (storage is integer centavos throughout).
 */

const BUNDLE_VERSION = 1

type PortableProfile = Omit<TaxProfile, 'registeredTaxTypes'> & { registeredTaxTypes: string[] }

export interface CompanyBundle {
  readonly kind: 'ph-books-company'
  readonly version: number
  readonly exportedAt: string
  readonly company: Company
  readonly profiles: PortableProfile[]
  readonly accounts: Account[]
  readonly parties: Party[]
  readonly employees: Employee[]
  readonly bankAccounts: BankAccount[]
  readonly items: Item[]
  readonly atcCodes: AtcCode[]
  readonly numbering: NumberingSeries[]
  readonly sheets: Sheet[]
  readonly journal: JournalEntry[]
  readonly periodLocks: PeriodLock[]
  readonly generatedReturns: GeneratedReturn[]
  readonly audit: AuditEvent[]
}

export async function exportCompany(port: DataPort, companyId: string): Promise<CompanyBundle> {
  const company = await port.companies.get(companyId)
  if (!company) throw new Error(`No company ${companyId}`)
  const profiles = await port.taxProfiles.listVersions(companyId)
  return {
    kind: 'ph-books-company',
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    company,
    profiles: profiles.map((p) => ({ ...p, registeredTaxTypes: [...p.registeredTaxTypes] })),
    accounts: await port.accounts.list(companyId),
    parties: await port.parties.list(companyId),
    employees: await port.employees.list(companyId),
    bankAccounts: await port.bankAccounts.list(companyId),
    items: await port.items.list(companyId),
    atcCodes: await port.atcCodes.list(companyId),
    numbering: await port.numbering.list(companyId),
    sheets: await port.sheets.list(companyId),
    journal: await port.journal.list(companyId),
    periodLocks: await port.periodLocks.list(companyId),
    generatedReturns: await port.generatedReturns.list(companyId),
    audit: await port.audit.list(companyId, 100_000),
  }
}

export function parseCompanyBundle(json: string): CompanyBundle {
  const parsed: unknown = JSON.parse(json)
  const b = parsed as CompanyBundle
  if (!b || b.kind !== 'ph-books-company') {
    throw new Error('Not a PH Books company export (missing kind: "ph-books-company")')
  }
  if (b.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version ${b.version}; this build reads version ${BUNDLE_VERSION}`)
  }
  if (!b.company?.id) throw new Error('Bundle has no company record')
  return b
}

/**
 * Import a bundle. Refuses when the company id already exists — imports
 * never silently merge into or overwrite existing books.
 */
export async function importCompany(port: DataPort, bundle: CompanyBundle): Promise<Company> {
  if (await port.companies.get(bundle.company.id)) {
    throw new Error(
      `Company ${bundle.company.registeredName} (${bundle.company.id}) already exists here — delete or rename it first`,
    )
  }
  await port.companies.save(bundle.company)
  for (const p of bundle.profiles) {
    await port.taxProfiles.save(bundle.company.id, {
      ...p,
      registeredTaxTypes: new Set(p.registeredTaxTypes as never[]),
    } as TaxProfile)
  }
  await port.accounts.saveMany(bundle.accounts)
  for (const x of bundle.parties) await port.parties.save(x)
  for (const x of bundle.employees) await port.employees.save(x)
  for (const x of bundle.bankAccounts) await port.bankAccounts.save(x)
  for (const x of bundle.items) await port.items.save(x)
  for (const x of bundle.atcCodes) await port.atcCodes.save(x)
  for (const x of bundle.numbering) await port.numbering.save(x)
  // Posted sheets must exist as posted; go through saveDraft/postDocument
  // would re-validate — the bundle is already-valid history, so restore
  // drafts first, then posted pairs through the atomic path.
  const drafts = bundle.sheets.filter((s) => s.status === 'draft')
  for (const s of drafts) await port.sheets.saveDraft(s)
  const entryById = new Map(bundle.journal.map((e) => [e.id, e]))
  const posted = bundle.sheets.filter((s) => s.status === 'posted')
  for (const s of posted) {
    const entry = s.postedEntryId ? entryById.get(s.postedEntryId) : undefined
    if (entry) {
      await port.postDocument({ sheet: s, entry })
      entryById.delete(entry.id)
    } else {
      // Posted sheet without its entry in the bundle: restore as-is via draft+mark.
      await port.sheets.saveDraft({ ...s, status: 'draft', postedEntryId: null })
      await port.sheets.markPosted(s.id, s.postedEntryId ?? '')
    }
  }
  // Entries with no sheet (reversals, imported GJ history).
  for (const e of entryById.values()) await port.journal.append(e)
  for (const l of bundle.periodLocks) await port.periodLocks.append(l)
  for (const g of bundle.generatedReturns) await port.generatedReturns.save(g)
  for (const a of bundle.audit) await port.audit.append(a)
  await port.audit.append(
    auditEvent(
      bundle.company.id,
      'company_imported',
      `company:${bundle.company.id}`,
      `Imported from bundle exported ${bundle.exportedAt} (${bundle.journal.length} entries, ${bundle.sheets.length} sheets)`,
    ),
  )
  return bundle.company
}
