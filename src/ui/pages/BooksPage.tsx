import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import { Money, sum } from '../../lib/money'
import {
  buildCashDisbursementsJournal,
  buildCashReceiptsJournal,
  buildGeneralJournal,
  buildGeneralLedger,
  buildPurchaseJournal,
  buildSalesJournal,
} from '../../reports/books'
import { ExportButtons } from '../components/ExportButtons'
import { PrintDoc, type PrintColumn, type PrintRow } from '../print/PrintDoc'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

/**
 * Books of accounts in the columnar layouts BIR expects for loose-leaf and
 * CAS submission: general journal, general ledger, cash receipts, cash
 * disbursements, sales journal, purchase journal — each with an on-screen
 * preview and a paginated print view.
 */

type BookKey = 'gj' | 'gl' | 'crb' | 'cdb' | 'sj' | 'pj'

const BOOKS: { key: BookKey; label: string; title: string }[] = [
  { key: 'gj', label: 'General journal', title: 'General Journal' },
  { key: 'gl', label: 'General ledger', title: 'General Ledger' },
  { key: 'crb', label: 'Cash receipts', title: 'Cash Receipts Book' },
  { key: 'cdb', label: 'Cash disbursements', title: 'Cash Disbursements Book' },
  { key: 'sj', label: 'Sales journal', title: 'Sales Journal' },
  { key: 'pj', label: 'Purchase journal', title: 'Purchase Journal' },
]

const year = new Date().getFullYear()

export function BooksPage() {
  const companyId = useSelectedCompanyId()
  const { entries, accounts, sheets, parties } = useCompanyData(companyId)
  const companyQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => dataPort().companies.get(companyId!),
    enabled: !!companyId,
  })
  const [book, setBook] = useState<BookKey>('gj')
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)
  const [printing, setPrinting] = useState(false)

  const doc = useMemo((): { columns: PrintColumn[]; rows: PrintRow[] } => {
    const es = entries.data ?? []
    const as = accounts.data ?? []
    const ss = sheets.data ?? []
    const ps = parties.data ?? []
    const range = { from, to }
    const m = (x: Money) => (x.isZero() ? '' : x.format())

    switch (book) {
      case 'gj': {
        const rows = buildGeneralJournal(es, as, range)
        const out: PrintRow[] = rows.map((r) => ({
          cells: [r.date, String(r.entryNo), r.accountCode, r.accountTitle, r.particulars, m(r.debit), m(r.credit)],
        }))
        out.push({
          kind: 'total',
          cells: ['', '', '', '', 'TOTALS', sum(rows.map((r) => r.debit)).format(), sum(rows.map((r) => r.credit)).format()],
        })
        return {
          columns: [
            { header: 'Date', width: '70px' },
            { header: 'Entry №', width: '48px' },
            { header: 'Code', width: '48px' },
            { header: 'Account Title', width: '140px' },
            { header: 'Particulars' },
            { header: 'Debit', align: 'right', width: '90px' },
            { header: 'Credit', align: 'right', width: '90px' },
          ],
          rows: out,
        }
      }
      case 'gl': {
        const sections = buildGeneralLedger(es, as, range)
        const out: PrintRow[] = []
        for (const s of sections) {
          out.push({ kind: 'section', cells: [`${s.accountCode} — ${s.accountTitle}`] })
          for (const l of s.lines) {
            out.push({
              cells: [l.date, String(l.entryNo), l.description, m(l.debit), m(l.credit), l.runningBalance.format()],
            })
          }
          out.push({ kind: 'total', cells: ['', '', 'Ending balance', '', '', s.endingBalance.format()] })
        }
        return {
          columns: [
            { header: 'Date', width: '70px' },
            { header: 'Ref', width: '40px' },
            { header: 'Particulars' },
            { header: 'Debit', align: 'right', width: '90px' },
            { header: 'Credit', align: 'right', width: '90px' },
            { header: 'Balance', align: 'right', width: '95px' },
          ],
          rows: out,
        }
      }
      case 'crb':
      case 'cdb': {
        const rows =
          book === 'crb'
            ? buildCashReceiptsJournal(es, ss, ps, range)
            : buildCashDisbursementsJournal(es, ss, ps, range)
        const out: PrintRow[] = rows.map((r) => ({
          cells: [r.date, r.documentNo, r.counterparty, r.particulars, r.cash.format(), r.sundryAccountCode, m(r.sundryAmount)],
        }))
        out.push({
          kind: 'total',
          cells: ['', '', '', 'TOTAL', sum(rows.map((r) => r.cash)).format(), '', ''],
        })
        return {
          columns: [
            { header: 'Date', width: '70px' },
            { header: 'Doc №', width: '75px' },
            { header: book === 'crb' ? 'Received From' : 'Paid To', width: '130px' },
            { header: 'Particulars' },
            { header: book === 'crb' ? 'Cash (Dr)' : 'Cash (Cr)', align: 'right', width: '90px' },
            { header: 'Sundry Acct', width: '60px' },
            { header: 'Sundry Amount', align: 'right', width: '90px' },
          ],
          rows: out,
        }
      }
      case 'sj': {
        const rows = buildSalesJournal(es, ss, ps, range)
        const out: PrintRow[] = rows.map((r) => ({
          cells: [r.date, r.documentNo, r.customerName, r.customerTin, m(r.vatableSales), m(r.exemptSales), m(r.zeroRatedSales), m(r.outputVat), r.total.format()],
        }))
        out.push({
          kind: 'total',
          cells: [
            '', '', '', 'TOTALS',
            sum(rows.map((r) => r.vatableSales)).format(),
            sum(rows.map((r) => r.exemptSales)).format(),
            sum(rows.map((r) => r.zeroRatedSales)).format(),
            sum(rows.map((r) => r.outputVat)).format(),
            sum(rows.map((r) => r.total)).format(),
          ],
        })
        return {
          columns: [
            { header: 'Date', width: '68px' },
            { header: 'Invoice №', width: '72px' },
            { header: 'Customer' },
            { header: 'TIN', width: '110px' },
            { header: 'VATable', align: 'right', width: '85px' },
            { header: 'Exempt', align: 'right', width: '80px' },
            { header: 'Zero-Rated', align: 'right', width: '80px' },
            { header: 'Output VAT', align: 'right', width: '85px' },
            { header: 'Total', align: 'right', width: '90px' },
          ],
          rows: out,
        }
      }
      case 'pj': {
        const rows = buildPurchaseJournal(es, ss, ps, range)
        const out: PrintRow[] = rows.map((r) => ({
          cells: [r.date, r.documentNo, r.supplierName, r.supplierTin, m(r.purchases), m(r.inputVat), m(r.ewtWithheld), r.total.format()],
        }))
        out.push({
          kind: 'total',
          cells: [
            '', '', '', 'TOTALS',
            sum(rows.map((r) => r.purchases)).format(),
            sum(rows.map((r) => r.inputVat)).format(),
            sum(rows.map((r) => r.ewtWithheld)).format(),
            sum(rows.map((r) => r.total)).format(),
          ],
        })
        return {
          columns: [
            { header: 'Date', width: '68px' },
            { header: 'Ref №', width: '72px' },
            { header: 'Supplier' },
            { header: 'TIN', width: '110px' },
            { header: 'Purchases', align: 'right', width: '90px' },
            { header: 'Input VAT', align: 'right', width: '85px' },
            { header: 'EWT', align: 'right', width: '80px' },
            { header: 'Total', align: 'right', width: '90px' },
          ],
          rows: out,
        }
      }
    }
  }, [book, entries.data, accounts.data, sheets.data, parties.data, from, to])

  if (!companyId) return <p className="text-slate-500">Select a company.</p>
  const meta = BOOKS.find((b) => b.key === book)!

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Books of accounts</h1>
          <p className="text-sm text-slate-500">
            BIR columnar layouts for loose-leaf / CAS — print via the browser, no PDF library.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          <ExportButtons
            filename={`${book}-${from}-${to}`}
            sheetName={BOOKS.find((b) => b.key === book)!.label}
            headers={doc.columns.map((c) => c.header)}
            rows={doc.rows.map((r) =>
              r.kind === 'section' ? [r.cells[0] ?? ''] : r.cells.map((c) => c),
            )}
          />
          <button
            onClick={() => setPrinting(true)}
            disabled={!companyQ.data}
            className="rounded-lg bg-brand-600 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            Print view
          </button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {BOOKS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBook(b.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              b.key === book ? 'bg-brand-600 font-medium text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {b.label}
          </button>
        ))}
      </nav>

      <section className="overflow-x-auto rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              {doc.columns.map((c, i) => (
                <th key={i} className={`py-1.5 pr-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((r, i) =>
              r.kind === 'section' ? (
                <tr key={i} className="border-t border-slate-200 bg-slate-50">
                  <td colSpan={doc.columns.length} className="py-1.5 pr-3 font-semibold">{r.cells[0]}</td>
                </tr>
              ) : (
                <tr key={i} className={`border-t border-slate-100 ${r.kind === 'total' ? 'font-semibold' : ''}`}>
                  {r.cells.map((c, j) => (
                    <td key={j} className={`py-1.5 pr-3 ${doc.columns[j]?.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ),
            )}
            {doc.rows.length === 0 && (
              <tr>
                <td colSpan={doc.columns.length} className="py-4 text-slate-400">Nothing in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {printing && companyQ.data && (
        <PrintDoc
          title={meta.title}
          company={companyQ.data}
          periodLabel={`For the period ${from} to ${to}`}
          columns={doc.columns}
          rows={doc.rows}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  )
}
