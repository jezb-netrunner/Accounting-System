import type { BankAccountId, CompanyId, EmployeeId, ItemId, PartyId, RegisteredParty } from './core'
import { pct } from '../lib/money'
import type { AtcRateRule, PayeeClass, WithholdingKind } from '../tax/rules/withholding'
import type { VatClass } from '../tax/engine/vat'
import type { Sheet } from './sheets'

/** Customers and suppliers share a shape; role flags keep one party list. */
export interface Party extends RegisteredParty {
  readonly id: PartyId
  readonly companyId: CompanyId
  readonly isCustomer: boolean
  readonly isSupplier: boolean
  readonly payeeClass: PayeeClass
  readonly isGovernment: boolean
  /** Default ATC applied to purchases from this supplier, when any. */
  readonly defaultAtc: string | null
  /** Set when this record was merged into another; referenced history resolves through it. */
  readonly mergedIntoId?: PartyId | null
  readonly active: boolean
}

export interface Employee extends RegisteredParty {
  readonly id: EmployeeId
  readonly companyId: CompanyId
  readonly employeeNo: string
  readonly firstName: string
  readonly lastName: string
  readonly middleName: string | null
  readonly hireDate: string
  readonly separationDate: string | null
  readonly monthlyBasicPayCentavos: number
  /** Statutory numbers. */
  readonly sssNo: string | null
  readonly philhealthNo: string | null
  readonly pagibigNo: string | null
  readonly active: boolean
}

export interface BankAccount {
  readonly id: BankAccountId
  readonly companyId: CompanyId
  readonly bankName: string
  readonly accountName: string
  readonly accountNo: string
  /** GL account this bank account posts to. */
  readonly glAccountCode: string
  readonly active: boolean
}

export interface Item {
  readonly id: ItemId
  readonly companyId: CompanyId
  readonly sku: string
  readonly name: string
  readonly kind: 'good' | 'service'
  readonly unitPriceCentavos: number
  /** Default VAT class for lines using this item; profile still governs. */
  readonly defaultVatClass: VatClass
  readonly incomeAccountCode: string
  readonly expenseAccountCode: string | null
  readonly active: boolean
}

/** BIR Revenue District Office reference row (master list ships as seed). */
export interface RdoCode {
  readonly code: string
  readonly name: string
}

/** A few common RDOs as reference seed; the full list imports as master data. */
export const RDO_SEED: readonly RdoCode[] = [
  { code: '039', name: 'South Quezon City' },
  { code: '044', name: 'Taguig-Pateros' },
  { code: '047', name: 'East Makati' },
  { code: '049', name: 'North Makati' },
  { code: '050', name: 'South Makati' },
  { code: '081', name: 'Cebu City North' },
  { code: '113A', name: 'West Davao City' },
]

/**
 * Document numbering series: one per document type (or per branch/booklet).
 * BIR requires sequential, gap-explained numbering on invoices.
 */
export interface NumberingSeries {
  readonly id: string
  readonly companyId: CompanyId
  readonly documentType: string
  readonly prefix: string
  readonly padding: number
  readonly nextNumber: number
  /** ATP/OCN or printer accreditation reference, when applicable. */
  readonly authorityRef: string | null
}

export const formatDocumentNo = (series: NumberingSeries, n: number): string =>
  `${series.prefix}${String(n).padStart(series.padding, '0')}`

/**
 * Company-level ATC master data extending the built-in seed matrix. Rows the
 * rules table doesn't know become pickable and compute at this flat rate.
 */
export interface AtcCode {
  readonly id: string
  readonly companyId: CompanyId
  readonly atc: string
  readonly kind: WithholdingKind
  readonly payeeClass: PayeeClass
  readonly natureOfPayment: string
  /** Percent with up to 4 decimals (e.g. 1, 2, 7.5). */
  readonly ratePercent: number
  readonly active: boolean
}

export const atcCodeToRule = (a: AtcCode): AtcRateRule => ({
  atc: a.atc,
  kind: a.kind,
  payeeClass: a.payeeClass,
  natureOfPayment: a.natureOfPayment,
  rate: pct(a.ratePercent),
  higherRate: null,
  higherRateThresholdCentavos: null,
})

// ---- Reference checks: what may be deleted vs merely deactivated ----

export const referencedPartyIds = (sheets: readonly Sheet[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of sheets) if (s.partyId) ids.add(s.partyId)
  return ids
}

export const referencedItemIds = (sheets: readonly Sheet[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of sheets) for (const l of s.lines) if (l.itemId) ids.add(l.itemId)
  return ids
}

export const referencedEmployeeIds = (sheets: readonly Sheet[]): Set<string> => {
  const ids = new Set<string>()
  for (const s of sheets) for (const l of s.lines) if (l.employeeId) ids.add(l.employeeId)
  return ids
}
