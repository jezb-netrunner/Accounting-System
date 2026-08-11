import type { BankAccountId, CompanyId, EmployeeId, ItemId, PartyId, RegisteredParty } from './core'
import type { PayeeClass } from '../tax/rules/withholding'
import type { VatClass } from '../tax/engine/vat'

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
