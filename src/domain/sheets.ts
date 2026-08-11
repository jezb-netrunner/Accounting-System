import type { CompanyId, ISODate, JournalEntryId, PartyId, SheetId } from './core'
import type { VatClass } from '../tax/engine/vat'

/**
 * Transaction sheets: the entry surfaces of the app. Each sheet is a draft
 * until posted; posting is the only path to the ledger.
 */
export type SheetType =
  | 'sales_invoice'
  | 'sales_receipt'
  | 'purchase_bill'
  | 'collection'
  | 'disbursement'
  | 'general_journal'
  | 'payroll_register'
  | 'credit_memo'
  | 'debit_memo'

export const SHEET_TYPE_LABELS: Record<SheetType, string> = {
  sales_invoice: 'Sales Invoice',
  sales_receipt: 'Sales Receipt',
  purchase_bill: 'Purchase Bill',
  collection: 'Collection',
  disbursement: 'Disbursement',
  general_journal: 'General Journal',
  payroll_register: 'Payroll Register',
  credit_memo: 'Credit Memo',
  debit_memo: 'Debit Memo',
}

export type SheetStatus = 'draft' | 'posted' | 'void'

export interface SheetLine {
  readonly lineNo: number
  readonly description: string
  /** Direct account reference (general journal, disbursement distribution). */
  readonly accountCode: string | null
  readonly itemId: string | null
  readonly quantity: number | null
  readonly amountCentavos: number
  readonly amountIsVatInclusive: boolean
  readonly vatClass: VatClass
  readonly atc: string | null
  /** General journal only: which side this line hits. */
  readonly side: 'debit' | 'credit' | null
}

export interface Sheet {
  readonly id: SheetId
  readonly companyId: CompanyId
  readonly type: SheetType
  readonly documentNo: string
  readonly date: ISODate
  readonly partyId: PartyId | null
  readonly memo: string
  readonly lines: readonly SheetLine[]
  readonly status: SheetStatus
  /** Set exactly once, when posted. */
  readonly postedEntryId: JournalEntryId | null
  /** Payment sheets (collection/disbursement): bank GL account. */
  readonly bankAccountCode: string | null
  /** Payroll register: period covered. */
  readonly payrollPeriod: { from: ISODate; to: ISODate } | null
}

export const isSaleSheet = (t: SheetType): boolean =>
  t === 'sales_invoice' || t === 'sales_receipt' || t === 'credit_memo'

export const isPurchaseSheet = (t: SheetType): boolean =>
  t === 'purchase_bill' || t === 'debit_memo'
