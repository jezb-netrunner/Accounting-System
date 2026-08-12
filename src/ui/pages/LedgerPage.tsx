import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import type { JournalEntry } from '../../domain/journal'
import { accountLedgerWindow, trialBalance } from '../../domain/ledger'
import { buildPartyAging, partyBalances, partySubledger } from '../../domain/subledger'
import { Money } from '../../lib/money'
import { ExportButtons } from '../components/ExportButtons'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

/**
 * Ledger views: general ledger per account (opening balance, movements,
 * running balance), AR/AP subsidiary ledgers by party with control-account
 * tie-out, aging by bucket, trial balance (ties by construction), and the
 * audit trail. Every row drills to its journal entry, which links back to
 * the source document and forward to any reversal.
 */

export type LedgerView = 'gl' | 'ar' | 'ap' | 'aging' | 'tb' | 'audit'

const VIEWS: { key: LedgerView; label: string }[] = [
  { key: 'gl', label: 'General ledger' },
  { key: 'ar', label: 'AR subledger' },
  { key: 'ap', label: 'AP subledger' },
  { key: 'aging', label: 'AR/AP aging' },
  { key: 'tb', label: 'Trial balance' },
  { key: 'audit', label: 'Audit trail' },
]

const year = new Date().getFullYear()
const today = () => new Date().toISOString().slice(0, 10)

export function LedgerPage() {
  const { view } = useParams({ from: '/app/ledger/$view' }) as { view: LedgerView }
  const companyId = useSelectedCompanyId()
  const { accounts, entries, parties, sheets } = useCompanyData(companyId)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(today())
  const [drill, setDrill] = useState<JournalEntry | null>(null)

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  const es = entries.data ?? []
  const as = accounts.data ?? []
  const ps = parties.data ?? []

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Ledgers</h1>
          <p className="text-sm text-slate-500">
            Every figure links back to its journal entry and source document.
          </p>
        </div>
        {view !== 'audit' && (
          <div className="flex gap-2 text-sm">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </div>
        )}
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            to="/app/ledger/$view"
            params={{ view: v.key }}
            className={`rounded-full px-3 py-1.5 text-sm ${
              v.key === view
                ? 'bg-brand-600 font-medium text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === 'gl' && (
        <GeneralLedgerView entries={es} accounts={as} from={from} to={to} onDrill={setDrill} />
      )}
      {(view === 'ar' || view === 'ap') && (
        <SubledgerView
          role={view === 'ar' ? 'accounts_receivable' : 'accounts_payable'}
          entries={es}
          accounts={as}
          parties={ps}
          to={to}
          onDrill={setDrill}
        />
      )}
      {view === 'aging' && <AgingView entries={es} accounts={as} parties={ps} asOf={to} />}
      {view === 'tb' && <TrialBalanceView entries={es} accounts={as} asOf={to} />}
      {view === 'audit' && <AuditView companyId={companyId} />}

      {drill && (
        <EntryModal
          entry={drill}
          entries={es}
          sheets={sheets.data ?? []}
          onClose={() => setDrill(null)}
          onDrill={setDrill}
        />
      )}
    </div>
  )
}

const Card = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
    {title && <h2 className="mb-3 font-semibold">{title}</h2>}
    {children}
  </section>
)

const num = (m: Money) => (m.isZero() ? '' : m.format())

function GeneralLedgerView({
  entries,
  accounts,
  from,
  to,
  onDrill,
}: {
  entries: JournalEntry[]
  accounts: { code: string; name: string; postable: boolean }[]
  from: string
  to: string
  onDrill(e: JournalEntry): void
}) {
  const postable = accounts.filter((a) => a.postable)
  const [code, setCode] = useState('')
  const account = postable.find((a) => a.code === code) ?? postable[0]
  const w = useMemo(
    () => (account ? accountLedgerWindow(entries, account.code, from, to) : null),
    [entries, account, from, to],
  )
  const findEntry = (entryNo: number) => entries.find((e) => e.entryNo === entryNo)

  return (
    <Card>
      <div className="mb-3 flex items-center gap-3">
        <select value={account?.code ?? ''} onChange={(e) => setCode(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          {postable.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </div>
      {w && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">Date</th>
              <th className="py-1.5 pr-3">Entry</th>
              <th className="py-1.5 pr-3">Particulars</th>
              <th className="py-1.5 pr-3 text-right">Debit</th>
              <th className="py-1.5 pr-3 text-right">Credit</th>
              <th className="py-1.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-slate-50/60">
              <td colSpan={5} className="py-1.5 pr-3 font-medium">Opening balance ({from})</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{w.opening.format()}</td>
            </tr>
            {w.lines.map((l, i) => (
              <tr
                key={i}
                className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40"
                onClick={() => {
                  const e = findEntry(l.entryNo)
                  if (e) onDrill(e)
                }}
              >
                <td className="py-1.5 pr-3">{l.date}</td>
                <td className="py-1.5 pr-3 text-slate-500">#{l.entryNo}</td>
                <td className="py-1.5 pr-3">{l.description}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{num(l.debit)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{num(l.credit)}</td>
                <td className="py-1.5 text-right tabular-nums">{l.runningBalance.format()}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td colSpan={5} className="py-1.5 pr-3">Closing balance ({to})</td>
              <td className="py-1.5 text-right tabular-nums">{w.closing.format()}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  )
}

function SubledgerView({
  role,
  entries,
  accounts,
  parties,
  to,
  onDrill,
}: {
  role: 'accounts_receivable' | 'accounts_payable'
  entries: JournalEntry[]
  accounts: { code: string; systemRole: string | null }[]
  parties: { id: string; registeredName: string }[]
  to: string
  onDrill(e: JournalEntry): void
}) {
  const codes = useMemo(
    () => new Set(accounts.filter((a) => a.systemRole === role).map((a) => a.code)),
    [accounts, role],
  )
  const balances = useMemo(() => partyBalances(entries, codes, to), [entries, codes, to])
  const [openParty, setOpenParty] = useState<string | null>(null)
  const nameOf = (id: string) => parties.find((p) => p.id === id)?.registeredName ?? id

  const controlTotal = useMemo(() => {
    let c = 0
    for (const e of entries) {
      if (e.date > to) continue
      for (const l of e.lines) if (codes.has(l.accountCode)) c += l.debitCentavos - l.creditCentavos
    }
    return Money.fromCentavos(c)
  }, [entries, codes, to])
  const subTotal = balances.reduce((a, b) => a.add(b.balance), Money.ZERO)
  const unattributed = controlTotal.subtract(subTotal)

  return (
    <Card title={role === 'accounts_receivable' ? 'Accounts receivable by customer' : 'Accounts payable by supplier'}>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1.5 pr-3">Party</th>
            <th className="py-1.5 pr-3 text-right">Debits</th>
            <th className="py-1.5 pr-3 text-right">Credits</th>
            <th className="py-1.5 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {balances.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-slate-400">No activity.</td>
            </tr>
          )}
          {balances.map((b) => (
            <tr key={b.partyId} className="border-t border-slate-100">
              <td className="py-1.5 pr-3">
                <button className="text-brand-700 hover:underline" onClick={() => setOpenParty(openParty === b.partyId ? null : b.partyId)}>
                  {nameOf(b.partyId)}
                </button>
                {openParty === b.partyId && (
                  <table className="my-2 w-full rounded bg-slate-50 text-xs">
                    <tbody>
                      {partySubledger(entries, codes, b.partyId).map((l, i) => (
                        <tr
                          key={i}
                          className="cursor-pointer hover:bg-brand-50/50"
                          onClick={() => {
                            const e = entries.find((x) => x.entryNo === l.entryNo)
                            if (e) onDrill(e)
                          }}
                        >
                          <td className="px-2 py-1">{l.date}</td>
                          <td className="px-2 py-1 text-slate-500">#{l.entryNo}</td>
                          <td className="px-2 py-1">{l.description}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{num(l.debit)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{num(l.credit)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{l.runningBalance.format()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </td>
              <td className="py-1.5 pr-3 text-right align-top tabular-nums">{b.debit.format()}</td>
              <td className="py-1.5 pr-3 text-right align-top tabular-nums">{b.credit.format()}</td>
              <td className="py-1.5 text-right align-top tabular-nums">{b.balance.format()}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-1.5 pr-3">Subledger total</td>
            <td colSpan={2} />
            <td className="py-1.5 text-right tabular-nums">{subTotal.format()}</td>
          </tr>
          <tr className={unattributed.isZero() ? 'text-brand-700' : 'text-amber-700'}>
            <td className="py-1.5 pr-3">
              Control account {unattributed.isZero() ? 'ties ✓' : `has unattributed postings of ${unattributed.format()}`}
            </td>
            <td colSpan={2} />
            <td className="py-1.5 text-right tabular-nums">{controlTotal.format()}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function AgingView({
  entries,
  accounts,
  parties,
  asOf,
}: {
  entries: JournalEntry[]
  accounts: { code: string; systemRole: string | null }[]
  parties: { id: string; registeredName: string }[]
  asOf: string
}) {
  const nameOf = (id: string) => parties.find((p) => p.id === id)?.registeredName ?? id
  const sections = (['accounts_receivable', 'accounts_payable'] as const).map((role) => {
    const codes = new Set(accounts.filter((a) => a.systemRole === role).map((a) => a.code))
    const aging = buildPartyAging(entries, codes, asOf, role === 'accounts_receivable' ? 'debit' : 'credit')
    return { role, aging }
  })
  return (
    <>
      {sections.map(({ role, aging }) => (
        <Card key={role} title={`${role === 'accounts_receivable' ? 'Receivables' : 'Payables'} aging as of ${asOf}`}>
          <div className="mb-2 flex justify-end">
            <ExportButtons
              filename={`${role === 'accounts_receivable' ? 'ar' : 'ap'}-aging-${asOf}`}
              sheetName="Aging"
              headers={['Party', 'Current', '31-60', '61-90', 'Over 90', 'Total']}
              rows={[...aging.entries()].map(([partyId, b]) => [
                nameOf(partyId),
                b.current.format(),
                b.d31_60.format(),
                b.d61_90.format(),
                b.over90.format(),
                b.total.format(),
              ])}
            />
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1.5 pr-3">Party</th>
                <th className="py-1.5 pr-3 text-right">Current (≤30)</th>
                <th className="py-1.5 pr-3 text-right">31-60</th>
                <th className="py-1.5 pr-3 text-right">61-90</th>
                <th className="py-1.5 pr-3 text-right">Over 90</th>
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {aging.size === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-400">Nothing outstanding.</td>
                </tr>
              )}
              {[...aging.entries()].map(([partyId, b]) => (
                <tr key={partyId} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">{nameOf(partyId)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(b.current)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(b.d31_60)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(b.d61_90)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(b.over90)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{b.total.format()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  )
}

function TrialBalanceView({
  entries,
  accounts,
  asOf,
}: {
  entries: JournalEntry[]
  accounts: { code: string; name: string; postable: boolean; type: string; taxTag: string; systemRole: string | null; id: string; companyId: string; normalBalance: string; parentId: string | null; active: boolean }[]
  asOf: string
}) {
  const navigate = useNavigate()
  const tb = useMemo(() => trialBalance(entries, accounts as never, asOf), [entries, accounts, asOf])
  return (
    <Card title={`Trial balance as of ${asOf}`}>
      <div className="mb-2 flex justify-end">
        <ExportButtons
          filename={`trial-balance-${asOf}`}
          sheetName="Trial balance"
          headers={['Account', 'Debit', 'Credit']}
          rows={[
            ...tb.rows.map((r) => [`${r.accountCode} — ${r.accountName}`, r.debit.format(), r.credit.format()]),
            ['TOTALS', tb.totalDebit.format(), tb.totalCredit.format()],
          ]}
        />
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1.5 pr-3">Account</th>
            <th className="py-1.5 pr-3 text-right">Debit</th>
            <th className="py-1.5 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {tb.rows.map((r) => (
            <tr
              key={r.accountCode}
              className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40"
              title="Open in general ledger"
              onClick={() => void navigate({ to: '/app/ledger/$view', params: { view: 'gl' } })}
            >
              <td className="py-1.5 pr-3">{r.accountCode} — {r.accountName}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{num(r.debit)}</td>
              <td className="py-1.5 text-right tabular-nums">{num(r.credit)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-1.5 pr-3">Totals (tie by construction)</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{tb.totalDebit.format()}</td>
            <td className="py-1.5 text-right tabular-nums">{tb.totalCredit.format()}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function AuditView({ companyId }: { companyId: string }) {
  const q = useQuery({
    queryKey: ['audit', companyId],
    queryFn: () => dataPort().audit.list(companyId),
  })
  return (
    <Card title="Audit trail (newest first)">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1.5 pr-3">When</th>
            <th className="py-1.5 pr-3">Who</th>
            <th className="py-1.5 pr-3">Action</th>
            <th className="py-1.5">Detail</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-slate-400">No recorded events yet.</td>
            </tr>
          )}
          {(q.data ?? []).map((e) => (
            <tr key={e.id} className="border-t border-slate-100 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-slate-500">{e.at.replace('T', ' ').slice(0, 19)}</td>
              <td className="py-1.5 pr-3 text-xs">{e.actor}</td>
              <td className="py-1.5 pr-3">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.action.replace(/_/g, ' ')}</span>
              </td>
              <td className="py-1.5">
                {e.detail}
                {e.before !== undefined && e.after !== undefined ? (
                  <details className="mt-1 text-xs text-slate-500">
                    <summary className="cursor-pointer">before / after</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export function EntryModal({
  entry,
  entries,
  sheets,
  onClose,
  onDrill,
}: {
  entry: JournalEntry
  entries: JournalEntry[]
  sheets: { id: string; documentNo: string; type: string }[]
  onClose(): void
  onDrill(e: JournalEntry): void
}) {
  const navigate = useNavigate()
  const source = sheets.find((s) => s.id === entry.sheetId)
  const reversedBy = entries.find((e) => e.reversalOfEntryId === entry.id)
  const reverses = entry.reversalOfEntryId
    ? entries.find((e) => e.id === entry.reversalOfEntryId)
    : null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Journal entry #{entry.entryNo}</h2>
            <p className="text-sm text-slate-500">{entry.date} · {entry.description}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {source && (
            <button
              className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-100"
              onClick={() =>
                void navigate({
                  to: '/app/sheets/$sheetType',
                  params: { sheetType: source.type },
                  search: { open: source.id },
                })
              }
            >
              Source: {source.documentNo || '(draft)'} ↗
            </button>
          )}
          {reversedBy && (
            <button className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100" onClick={() => onDrill(reversedBy)}>
              Reversed by #{reversedBy.entryNo} →
            </button>
          )}
          {reverses && (
            <button className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100" onClick={() => onDrill(reverses)}>
              ← Reverses #{reverses.entryNo}
            </button>
          )}
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-3">Account</th>
              <th className="py-1 pr-3">Particulars</th>
              <th className="py-1 pr-3 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-mono text-xs">{l.accountCode}</td>
                <td className="py-1 pr-3">{l.description}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{l.debitCentavos ? Money.fromCentavos(l.debitCentavos).format() : ''}</td>
                <td className="py-1 text-right tabular-nums">{l.creditCentavos ? Money.fromCentavos(l.creditCentavos).format() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
