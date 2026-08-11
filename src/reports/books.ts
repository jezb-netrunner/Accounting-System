import type { ISODate } from '../domain/core'
import type { JournalEntry } from '../domain/journal'
import type { Party } from '../domain/masterData'
import { formatTIN } from '../domain/core'
import type { Sheet } from '../domain/sheets'
import { Money, sum } from '../lib/money'
import { accountLedger, type LedgerLine } from '../domain/ledger'
import type { Account } from '../domain/coa'

/**
 * Books of accounts in the columnar layouts BIR expects for loose-leaf /
 * CAS registration: general journal, general ledger, cash receipts, cash
 * disbursements, sales journal, purchase journal. These are typed row models
 * plus builders from posted data; renderers (print/export) come later.
 */

export interface BookRange {
  readonly from: ISODate
  readonly to: ISODate
}

const within = (d: ISODate, r: BookRange) => d >= r.from && d <= r.to

// ---- General Journal ----

export interface GeneralJournalRow {
  readonly date: ISODate
  readonly entryNo: number
  readonly particulars: string
  readonly accountCode: string
  readonly accountTitle: string
  readonly debit: Money
  readonly credit: Money
}

export function buildGeneralJournal(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  range: BookRange,
): GeneralJournalRow[] {
  const nameOf = new Map(accounts.map((a) => [a.code, a.name]))
  return entries
    .filter((e) => within(e.date, range))
    .sort((a, b) => a.entryNo - b.entryNo)
    .flatMap((e) =>
      e.lines.map((l) => ({
        date: e.date,
        entryNo: e.entryNo,
        particulars: l.description,
        accountCode: l.accountCode,
        accountTitle: nameOf.get(l.accountCode) ?? l.accountCode,
        debit: Money.fromCentavos(l.debitCentavos),
        credit: Money.fromCentavos(l.creditCentavos),
      })),
    )
}

// ---- General Ledger ----

export interface GeneralLedgerAccountSection {
  readonly accountCode: string
  readonly accountTitle: string
  readonly lines: readonly LedgerLine[]
  readonly endingBalance: Money
}

export function buildGeneralLedger(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  range: BookRange,
): GeneralLedgerAccountSection[] {
  const inRange = entries.filter((e) => within(e.date, range))
  return accounts
    .filter((a) => a.postable)
    .map((a) => {
      const lines = accountLedger(inRange, a.code)
      return {
        accountCode: a.code,
        accountTitle: a.name,
        lines,
        endingBalance: lines.length ? lines[lines.length - 1]!.runningBalance : Money.ZERO,
      }
    })
    .filter((s) => s.lines.length > 0)
}

// ---- Sales Journal (per document, VAT-columnar) ----

export interface SalesJournalRow {
  readonly date: ISODate
  readonly documentNo: string
  readonly customerName: string
  readonly customerTin: string
  readonly vatableSales: Money
  readonly exemptSales: Money
  readonly zeroRatedSales: Money
  readonly outputVat: Money
  readonly total: Money
}

const partyOf = (parties: readonly Party[], id: string | null) =>
  parties.find((p) => p.id === id) ?? null

/** Shared shape for the document-level VAT-columnar books. */
function documentVatColumns(entry: JournalEntry) {
  const byTag = (tag: string) =>
    sum(
      entry.lines
        .filter((l) => l.taxTag === tag)
        .map((l) => Money.fromCentavos(l.creditCentavos - l.debitCentavos)),
    )
  return { byTag }
}

export function buildSalesJournal(
  entries: readonly JournalEntry[],
  sheets: readonly Sheet[],
  parties: readonly Party[],
  range: BookRange,
): SalesJournalRow[] {
  const saleTypes = new Set(['sales_invoice', 'sales_receipt', 'credit_memo'])
  return sheets
    .filter((s) => s.status === 'posted' && saleTypes.has(s.type) && within(s.date, range))
    .map((s) => {
      const entry = entries.find((e) => e.sheetId === s.id)
      if (!entry) return null
      const { byTag } = documentVatColumns(entry)
      const party = partyOf(parties, s.partyId)
      const vatable = byTag('sales_vatable')
      const exempt = byTag('sales_exempt')
      const zeroRated = byTag('sales_zero_rated')
      const outputVat = byTag('output_vat')
      return {
        date: s.date,
        documentNo: s.documentNo,
        customerName: party?.registeredName ?? '—',
        customerTin: party ? formatTIN(party.tin) : '',
        vatableSales: vatable,
        exemptSales: exempt,
        zeroRatedSales: zeroRated,
        outputVat,
        total: vatable.add(exempt).add(zeroRated).add(outputVat),
      }
    })
    .filter((r): r is SalesJournalRow => r !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ---- Purchase Journal ----

export interface PurchaseJournalRow {
  readonly date: ISODate
  readonly documentNo: string
  readonly supplierName: string
  readonly supplierTin: string
  readonly purchases: Money
  readonly inputVat: Money
  readonly ewtWithheld: Money
  readonly total: Money
}

export function buildPurchaseJournal(
  entries: readonly JournalEntry[],
  sheets: readonly Sheet[],
  parties: readonly Party[],
  range: BookRange,
): PurchaseJournalRow[] {
  const purchaseTypes = new Set(['purchase_bill', 'debit_memo'])
  return sheets
    .filter((s) => s.status === 'posted' && purchaseTypes.has(s.type) && within(s.date, range))
    .map((s) => {
      const entry = entries.find((e) => e.sheetId === s.id)
      if (!entry) return null
      const party = partyOf(parties, s.partyId)
      const debitOf = (pred: (tag: string) => boolean) =>
        sum(
          entry.lines
            .filter((l) => pred(l.taxTag))
            .map((l) => Money.fromCentavos(l.debitCentavos - l.creditCentavos)),
        )
      const inputVat = debitOf((t) => t === 'input_vat' || t === 'deferred_input_vat')
      const ewt = sum(
        entry.lines
          .filter((l) => l.taxTag === 'ewt_payable' || l.taxTag === 'fwt_payable')
          .map((l) => Money.fromCentavos(l.creditCentavos - l.debitCentavos)),
      )
      // Cost columns = every debit-side line that isn't input VAT.
      const purchases = sum(
        entry.lines
          .filter(
            (l) =>
              l.debitCentavos > 0 && l.taxTag !== 'input_vat' && l.taxTag !== 'deferred_input_vat',
          )
          .map((l) => Money.fromCentavos(l.debitCentavos)),
      )
      return {
        date: s.date,
        documentNo: s.documentNo,
        supplierName: party?.registeredName ?? '—',
        supplierTin: party ? formatTIN(party.tin) : '',
        purchases,
        inputVat,
        ewtWithheld: ewt,
        total: purchases.add(inputVat),
      }
    })
    .filter((r): r is PurchaseJournalRow => r !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ---- Cash Receipts / Cash Disbursements ----

export interface CashBookRow {
  readonly date: ISODate
  readonly documentNo: string
  readonly counterparty: string
  readonly particulars: string
  readonly cash: Money
  readonly sundryAccountCode: string
  readonly sundryAmount: Money
}

function buildCashBook(
  entries: readonly JournalEntry[],
  sheets: readonly Sheet[],
  parties: readonly Party[],
  range: BookRange,
  sheetTypes: ReadonlySet<string>,
  cashSide: 'debit' | 'credit',
): CashBookRow[] {
  return sheets
    .filter((s) => s.status === 'posted' && sheetTypes.has(s.type) && within(s.date, range))
    .flatMap((s) => {
      const entry = entries.find((e) => e.sheetId === s.id)
      if (!entry) return []
      const party = partyOf(parties, s.partyId)
      const cash = sum(
        entry.lines.map((l) =>
          Money.fromCentavos(cashSide === 'debit' ? l.debitCentavos : l.creditCentavos),
        ),
      )
      const sundry = entry.lines.find((l) =>
        cashSide === 'debit' ? l.creditCentavos > 0 : l.debitCentavos > 0,
      )
      return [
        {
          date: s.date,
          documentNo: s.documentNo,
          counterparty: party?.registeredName ?? '—',
          particulars: entry.description,
          cash,
          sundryAccountCode: sundry?.accountCode ?? '',
          sundryAmount: Money.fromCentavos(
            sundry ? (cashSide === 'debit' ? sundry.creditCentavos : sundry.debitCentavos) : 0,
          ),
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const buildCashReceiptsJournal = (
  entries: readonly JournalEntry[],
  sheets: readonly Sheet[],
  parties: readonly Party[],
  range: BookRange,
): CashBookRow[] =>
  buildCashBook(entries, sheets, parties, range, new Set(['collection', 'sales_receipt']), 'debit')

export const buildCashDisbursementsJournal = (
  entries: readonly JournalEntry[],
  sheets: readonly Sheet[],
  parties: readonly Party[],
  range: BookRange,
): CashBookRow[] =>
  buildCashBook(entries, sheets, parties, range, new Set(['disbursement']), 'credit')
