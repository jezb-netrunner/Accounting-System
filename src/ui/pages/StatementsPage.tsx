import { useMemo, useState } from 'react'
import type { JournalEntry } from '../../domain/journal'
import { trialBalance } from '../../domain/ledger'
import { Money } from '../../lib/money'
import {
  buildBalanceSheet,
  buildCashFlow,
  buildIncomeStatement,
  type StatementLine,
} from '../../reports/financialStatements'
import { EntryModal } from './LedgerPage'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

/**
 * Financial statements with comparative prior-period columns and
 * drill-through: any figure opens the entries behind it, and each entry
 * links to its source document.
 */

type StatementKey = 'tb' | 'is' | 'bs' | 'cf'

const TABS: { key: StatementKey; label: string }[] = [
  { key: 'tb', label: 'Trial balance' },
  { key: 'is', label: 'Income statement' },
  { key: 'bs', label: 'Balance sheet' },
  { key: 'cf', label: 'Cash flow' },
]

const year = new Date().getFullYear()
const shiftYear = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`

interface Drill {
  accountCode: string
  label: string
  from: string | null
  to: string
}

export function StatementsPage() {
  const companyId = useSelectedCompanyId()
  const { entries, accounts, sheets } = useCompanyData(companyId)
  const [tab, setTab] = useState<StatementKey>('is')
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [entryModal, setEntryModal] = useState<JournalEntry | null>(null)

  const es = entries.data ?? []
  const as = accounts.data ?? []
  const priorFrom = shiftYear(from, -1)
  const priorTo = shiftYear(to, -1)

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Financial statements</h1>
          <p className="text-sm text-slate-500">
            Comparative columns show the same period a year earlier. Click any figure to see the
            entries behind it.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              t.key === tab ? 'bg-brand-600 font-medium text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'tb' && <TrialBalanceTab entries={es} accounts={as} to={to} priorTo={priorTo} onDrill={setDrill} />}
      {tab === 'is' && (
        <IncomeStatementTab entries={es} accounts={as} from={from} to={to} priorFrom={priorFrom} priorTo={priorTo} onDrill={setDrill} />
      )}
      {tab === 'bs' && <BalanceSheetTab entries={es} accounts={as} to={to} priorTo={priorTo} onDrill={setDrill} />}
      {tab === 'cf' && (
        <CashFlowTab entries={es} accounts={as} from={from} to={to} priorFrom={priorFrom} priorTo={priorTo} onDrill={setDrill} />
      )}

      {drill && (
        <DrillModal
          drill={drill}
          entries={es}
          onClose={() => setDrill(null)}
          onEntry={(e) => {
            setEntryModal(e)
          }}
        />
      )}
      {entryModal && (
        <EntryModal
          entry={entryModal}
          entries={es}
          sheets={sheets.data ?? []}
          onClose={() => setEntryModal(null)}
          onDrill={setEntryModal}
        />
      )}
    </div>
  )
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
    <h2 className="mb-3 font-semibold">{title}</h2>
    {children}
  </section>
)

function CompareTable({
  currentLabel,
  priorLabel,
  groups,
  onDrill,
  drillRange,
}: {
  currentLabel: string
  priorLabel: string
  groups: {
    title: string
    current: readonly StatementLine[]
    prior: readonly StatementLine[]
    totalLabel: string
    totalCurrent: Money
    totalPrior: Money
  }[]
  onDrill(d: Drill): void
  drillRange: { from: string | null; to: string; priorFrom: string | null; priorTo: string }
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1.5 pr-3">Line</th>
          <th className="py-1.5 pr-3 text-right">{currentLabel}</th>
          <th className="py-1.5 text-right">{priorLabel}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const codes = new Set([...g.current, ...g.prior].map((l) => l.accountCode))
          const rows = [...codes]
            .sort()
            .map((code) => ({
              code,
              label:
                g.current.find((l) => l.accountCode === code)?.label ??
                g.prior.find((l) => l.accountCode === code)?.label ??
                code,
              cur: g.current.find((l) => l.accountCode === code)?.amount ?? Money.ZERO,
              pri: g.prior.find((l) => l.accountCode === code)?.amount ?? Money.ZERO,
            }))
          return (
            <FragmentRows
              key={g.title}
              group={g}
              rows={rows}
              onDrill={onDrill}
              drillRange={drillRange}
            />
          )
        })}
      </tbody>
    </table>
  )
}

function FragmentRows({
  group,
  rows,
  onDrill,
  drillRange,
}: {
  group: { title: string; totalLabel: string; totalCurrent: Money; totalPrior: Money }
  rows: { code: string; label: string; cur: Money; pri: Money }[]
  onDrill(d: Drill): void
  drillRange: { from: string | null; to: string; priorFrom: string | null; priorTo: string }
}) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/70">
        <td colSpan={3} className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {group.title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.code} className="border-t border-slate-100">
          <td className="py-1.5 pr-3">{r.label}</td>
          <td className="py-1.5 pr-3 text-right">
            <button
              className="tabular-nums hover:text-brand-700 hover:underline"
              onClick={() =>
                onDrill({ accountCode: r.code, label: r.label, from: drillRange.from, to: drillRange.to })
              }
            >
              {r.cur.format()}
            </button>
          </td>
          <td className="py-1.5 text-right">
            <button
              className="tabular-nums text-slate-500 hover:text-brand-700 hover:underline"
              onClick={() =>
                onDrill({
                  accountCode: r.code,
                  label: r.label,
                  from: drillRange.priorFrom,
                  to: drillRange.priorTo,
                })
              }
            >
              {r.pri.format()}
            </button>
          </td>
        </tr>
      ))}
      <tr className="border-t border-slate-300 font-semibold">
        <td className="py-1.5 pr-3">{group.totalLabel}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{group.totalCurrent.format()}</td>
        <td className="py-1.5 text-right tabular-nums">{group.totalPrior.format()}</td>
      </tr>
    </>
  )
}

function IncomeStatementTab(props: {
  entries: JournalEntry[]
  accounts: never[] | object[]
  from: string
  to: string
  priorFrom: string
  priorTo: string
  onDrill(d: Drill): void
}) {
  const { entries, accounts, from, to, priorFrom, priorTo, onDrill } = props
  const cur = useMemo(() => buildIncomeStatement(entries, accounts as never, from, to), [entries, accounts, from, to])
  const pri = useMemo(
    () => buildIncomeStatement(entries, accounts as never, priorFrom, priorTo),
    [entries, accounts, priorFrom, priorTo],
  )
  return (
    <Card title={`Income statement — ${from} to ${to} (vs ${priorFrom} to ${priorTo})`}>
      <CompareTable
        currentLabel="Current"
        priorLabel="Prior year"
        drillRange={{ from, to, priorFrom, priorTo }}
        onDrill={onDrill}
        groups={[
          {
            title: 'Income',
            current: cur.income,
            prior: pri.income,
            totalLabel: 'Total income',
            totalCurrent: cur.totalIncome,
            totalPrior: pri.totalIncome,
          },
          {
            title: 'Expenses',
            current: cur.expenses,
            prior: pri.expenses,
            totalLabel: 'Total expenses',
            totalCurrent: cur.totalExpenses,
            totalPrior: pri.totalExpenses,
          },
          {
            title: 'Result',
            current: [],
            prior: [],
            totalLabel: 'Net income',
            totalCurrent: cur.netIncome,
            totalPrior: pri.netIncome,
          },
        ]}
      />
    </Card>
  )
}

function BalanceSheetTab(props: {
  entries: JournalEntry[]
  accounts: never[] | object[]
  to: string
  priorTo: string
  onDrill(d: Drill): void
}) {
  const { entries, accounts, to, priorTo, onDrill } = props
  const cur = useMemo(() => buildBalanceSheet(entries, accounts as never, to), [entries, accounts, to])
  const pri = useMemo(() => buildBalanceSheet(entries, accounts as never, priorTo), [entries, accounts, priorTo])
  return (
    <Card title={`Balance sheet as of ${to} (vs ${priorTo})`}>
      <CompareTable
        currentLabel={to}
        priorLabel={priorTo}
        drillRange={{ from: null, to, priorFrom: null, priorTo }}
        onDrill={onDrill}
        groups={[
          {
            title: 'Assets',
            current: cur.assets,
            prior: pri.assets,
            totalLabel: 'Total assets',
            totalCurrent: cur.totalAssets,
            totalPrior: pri.totalAssets,
          },
          {
            title: 'Liabilities',
            current: cur.liabilities,
            prior: pri.liabilities,
            totalLabel: 'Total liabilities',
            totalCurrent: cur.totalLiabilities,
            totalPrior: pri.totalLiabilities,
          },
          {
            title: 'Equity',
            current: cur.equity.filter((l) => l.accountCode !== ''),
            prior: pri.equity.filter((l) => l.accountCode !== ''),
            totalLabel: 'Total equity (incl. current earnings)',
            totalCurrent: cur.totalEquity,
            totalPrior: pri.totalEquity,
          },
        ]}
      />
      <p className="mt-2 text-xs text-slate-400">
        Liabilities + equity: {cur.totalLiabilities.add(cur.totalEquity).format()} — balances with
        assets by construction.
      </p>
    </Card>
  )
}

function CashFlowTab(props: {
  entries: JournalEntry[]
  accounts: never[] | object[]
  from: string
  to: string
  priorFrom: string
  priorTo: string
  onDrill(d: Drill): void
}) {
  const { entries, accounts, from, to, priorFrom, priorTo, onDrill } = props
  const cur = useMemo(() => buildCashFlow(entries, accounts as never, from, to), [entries, accounts, from, to])
  const pri = useMemo(() => buildCashFlow(entries, accounts as never, priorFrom, priorTo), [entries, accounts, priorFrom, priorTo])
  const total = (lines: readonly StatementLine[]) => lines.reduce((a, l) => a.add(l.amount), Money.ZERO)
  return (
    <Card title={`Cash flow — ${from} to ${to} (vs prior year)`}>
      <CompareTable
        currentLabel="Current"
        priorLabel="Prior year"
        drillRange={{ from, to, priorFrom, priorTo }}
        onDrill={onDrill}
        groups={[
          {
            title: 'Operating',
            current: cur.operating,
            prior: pri.operating,
            totalLabel: 'Net cash from operations',
            totalCurrent: total(cur.operating),
            totalPrior: total(pri.operating),
          },
          {
            title: 'Investing',
            current: cur.investing,
            prior: pri.investing,
            totalLabel: 'Net cash from investing',
            totalCurrent: total(cur.investing),
            totalPrior: total(pri.investing),
          },
          {
            title: 'Financing',
            current: cur.financing,
            prior: pri.financing,
            totalLabel: 'Net cash from financing',
            totalCurrent: total(cur.financing),
            totalPrior: total(pri.financing),
          },
          {
            title: 'Change in cash',
            current: [],
            prior: [],
            totalLabel: 'Net change in cash',
            totalCurrent: cur.netChange,
            totalPrior: pri.netChange,
          },
        ]}
      />
    </Card>
  )
}

function TrialBalanceTab(props: {
  entries: JournalEntry[]
  accounts: never[] | object[]
  to: string
  priorTo: string
  onDrill(d: Drill): void
}) {
  const { entries, accounts, to, priorTo, onDrill } = props
  const cur = useMemo(() => trialBalance(entries, accounts as never, to), [entries, accounts, to])
  const pri = useMemo(() => trialBalance(entries, accounts as never, priorTo), [entries, accounts, priorTo])
  const priOf = (code: string) => pri.rows.find((r) => r.accountCode === code)
  return (
    <Card title={`Trial balance as of ${to} (comparative ${priorTo})`}>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1.5 pr-3">Account</th>
            <th className="py-1.5 pr-3 text-right">Debit</th>
            <th className="py-1.5 pr-3 text-right">Credit</th>
            <th className="py-1.5 pr-3 text-right">Debit ({priorTo.slice(0, 4)})</th>
            <th className="py-1.5 text-right">Credit ({priorTo.slice(0, 4)})</th>
          </tr>
        </thead>
        <tbody>
          {cur.rows.map((r) => (
            <tr
              key={r.accountCode}
              className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40"
              onClick={() => onDrill({ accountCode: r.accountCode, label: r.accountName, from: null, to })}
            >
              <td className="py-1.5 pr-3">{r.accountCode} — {r.accountName}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.debit.isZero() ? '' : r.debit.format()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.credit.isZero() ? '' : r.credit.format()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                {priOf(r.accountCode)?.debit.isZero() !== false ? '' : priOf(r.accountCode)!.debit.format()}
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-500">
                {priOf(r.accountCode)?.credit.isZero() !== false ? '' : priOf(r.accountCode)!.credit.format()}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-1.5 pr-3">Totals (tie by construction)</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{cur.totalDebit.format()}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{cur.totalCredit.format()}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{pri.totalDebit.format()}</td>
            <td className="py-1.5 text-right tabular-nums text-slate-500">{pri.totalCredit.format()}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function DrillModal({
  drill,
  entries,
  onClose,
  onEntry,
}: {
  drill: Drill
  entries: JournalEntry[]
  onClose(): void
  onEntry(e: JournalEntry): void
}) {
  const rows = useMemo(() => {
    const out: { entry: JournalEntry; debit: number; credit: number; description: string }[] = []
    for (const e of entries) {
      if (e.date > drill.to) continue
      if (drill.from && e.date < drill.from) continue
      for (const l of e.lines) {
        if (l.accountCode !== drill.accountCode) continue
        out.push({ entry: e, debit: l.debitCentavos, credit: l.creditCentavos, description: l.description })
      }
    }
    return out.sort((a, b) => a.entry.date.localeCompare(b.entry.date))
  }, [drill, entries])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{drill.label}</h2>
            <p className="text-sm text-slate-500">
              {drill.from ? `${drill.from} to ${drill.to}` : `All activity through ${drill.to}`} — click an
              entry to open it (and its source document).
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Entry</th>
              <th className="py-1 pr-3">Particulars</th>
              <th className="py-1 pr-3 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-slate-400">No entries.</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => onEntry(r.entry)}>
                <td className="py-1 pr-3">{r.entry.date}</td>
                <td className="py-1 pr-3 text-slate-500">#{r.entry.entryNo}</td>
                <td className="py-1 pr-3">{r.description}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.debit ? Money.fromCentavos(r.debit).format() : ''}</td>
                <td className="py-1 text-right tabular-nums">{r.credit ? Money.fromCentavos(r.credit).format() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
