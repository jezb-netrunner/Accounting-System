import { useMemo, useState } from 'react'
import { buildPurchaseJournal, buildSalesJournal } from '../../reports/books'
import { buildBalanceSheet, buildIncomeStatement } from '../../reports/financialStatements'
import { availableForms } from '../../reports/returns/registry'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

const year = new Date().getFullYear()

export function ReportsPage() {
  const companyId = useSelectedCompanyId()
  const { profile, entries, accounts, sheets, parties } = useCompanyData(companyId)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)

  const range = { from, to }
  const salesJournal = useMemo(
    () =>
      entries.data && sheets.data && parties.data
        ? buildSalesJournal(entries.data, sheets.data, parties.data, range)
        : [],
    [entries.data, sheets.data, parties.data, from, to],
  )
  const purchaseJournal = useMemo(
    () =>
      entries.data && sheets.data && parties.data
        ? buildPurchaseJournal(entries.data, sheets.data, parties.data, range)
        : [],
    [entries.data, sheets.data, parties.data, from, to],
  )
  const incomeStatement = useMemo(
    () =>
      entries.data && accounts.data
        ? buildIncomeStatement(entries.data, accounts.data, from, to)
        : null,
    [entries.data, accounts.data, from, to],
  )
  const balanceSheet = useMemo(
    () => (entries.data && accounts.data ? buildBalanceSheet(entries.data, accounts.data, to) : null),
    [entries.data, accounts.data, to],
  )
  const forms = profile.data ? availableForms(profile.data) : []

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold">Books, statements &amp; returns</h1>
          <p className="text-sm text-slate-500">
            Everything below derives from posted, tagged journal entries.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
        </div>
      </header>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-2 font-semibold">Sales journal (BIR columnar)</h2>
        <BookTable
          headers={['Date', 'Doc №', 'Customer', 'TIN', 'VATable', 'Exempt', 'Zero-rated', 'Output VAT', 'Total']}
          rows={salesJournal.map((r) => [
            r.date, r.documentNo, r.customerName, r.customerTin,
            r.vatableSales.format(), r.exemptSales.format(), r.zeroRatedSales.format(),
            r.outputVat.format(), r.total.format(),
          ])}
        />
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-2 font-semibold">Purchase journal</h2>
        <BookTable
          headers={['Date', 'Doc №', 'Supplier', 'TIN', 'Purchases', 'Input VAT', 'EWT', 'Total']}
          rows={purchaseJournal.map((r) => [
            r.date, r.documentNo, r.supplierName, r.supplierTin,
            r.purchases.format(), r.inputVat.format(), r.ewtWithheld.format(), r.total.format(),
          ])}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <h2 className="mb-2 font-semibold">Income statement</h2>
          {incomeStatement && (
            <dl className="space-y-1 text-sm">
              {incomeStatement.income.map((l) => (
                <Row key={l.accountCode} label={l.label} value={l.amount.format()} />
              ))}
              <Row label="Total income" value={incomeStatement.totalIncome.format()} bold />
              {incomeStatement.expenses.map((l) => (
                <Row key={l.accountCode} label={l.label} value={`(${l.amount.format()})`} />
              ))}
              <Row label="Net income" value={incomeStatement.netIncome.format()} bold />
            </dl>
          )}
        </section>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <h2 className="mb-2 font-semibold">Balance sheet</h2>
          {balanceSheet && (
            <dl className="space-y-1 text-sm">
              <Row label="Total assets" value={balanceSheet.totalAssets.format()} bold />
              <Row label="Total liabilities" value={balanceSheet.totalLiabilities.format()} />
              <Row label="Total equity (incl. current earnings)" value={balanceSheet.totalEquity.format()} />
            </dl>
          )}
        </section>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-1 font-semibold">Returns this profile can produce</h2>
        <p className="mb-3 text-xs text-slate-400">
          Derived from the tax profile — forms outside the registration never appear.
        </p>
        <div className="flex flex-wrap gap-2">
          {forms.map((f) => (
            <span key={f.formCode} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" title={f.title}>
              <span className="font-semibold">{f.formCode}</span>
              <span className="ml-2 text-slate-500">{f.title}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

function BookTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="py-1.5 pr-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="py-3 text-slate-400">No rows in this range.</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 pr-3 ${j >= 4 ? 'text-right tabular-nums' : ''}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-slate-200 pt-1 font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
