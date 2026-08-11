import { useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import { periodOfDate } from '../../domain/core'
import { assertPostingAllowed } from '../../domain/periodClose'
import { indexAccounts, postSheet } from '../../domain/posting'
import { SHEET_TYPE_LABELS, type Sheet, type SheetLine, type SheetType } from '../../domain/sheets'
import { Money } from '../../lib/money'
import { deriveDocumentTotals } from '../../tax/engine/lineTax'
import { rules } from '../../tax/rules'
import { emptyLine, SheetGrid, type EditableLine } from '../sheets/SheetGrid'
import { useCompanyData, useInvalidateCompany, useSelectedCompanyId } from '../state/company'

const today = () => new Date().toISOString().slice(0, 10)

export function SheetsPage() {
  const { sheetType } = useParams({ from: '/app/sheets/$sheetType' }) as { sheetType: SheetType }
  const companyId = useSelectedCompanyId()
  const { accounts, profile, parties, sheets, locks } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()

  const [date, setDate] = useState(today())
  const [documentNo, setDocumentNo] = useState('')
  const [partyId, setPartyId] = useState('')
  const [lines, setLines] = useState<EditableLine[]>([emptyLine(), emptyLine(), emptyLine()])
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const isSale = sheetType === 'sales_invoice' || sheetType === 'sales_receipt' || sheetType === 'credit_memo'
  const isGJ = sheetType === 'general_journal'
  const isPayroll = sheetType === 'payroll_register'
  const columns = {
    showAccount: !isPayroll,
    showVatClass: !isGJ && !isPayroll,
    showAtc: !isGJ && !isPayroll,
    showSide: isGJ,
  }

  const accountOptions = useMemo(
    () => (accounts.data ?? []).filter((a) => a.postable).map((a) => ({ code: a.code, name: a.name })),
    [accounts.data],
  )
  const atcOptions = useMemo(() => {
    const party = (parties.data ?? []).find((p) => p.id === partyId)
    return rules
      .atcsForPayee(date, party?.payeeClass ?? 'corporation')
      .map((r) => ({ atc: r.atc, label: r.natureOfPayment }))
  }, [date, partyId, parties.data])

  /** Parse grid rows into domain SheetLines, skipping blank rows. */
  const parsedLines = useMemo((): SheetLine[] | { error: string } => {
    const out: SheetLine[] = []
    for (const [i, l] of lines.entries()) {
      if (!l.description && !l.amount) continue
      let amountCentavos: number
      try {
        amountCentavos = Money.parse(l.amount || '0').centavos
      } catch {
        return { error: `Line ${i + 1}: "${l.amount}" is not a valid amount` }
      }
      out.push({
        lineNo: i + 1,
        description: l.description,
        accountCode: l.accountCode || null,
        itemId: null,
        quantity: null,
        amountCentavos,
        amountIsVatInclusive: true,
        vatClass: isPayroll ? 'exempt' : l.vatClass,
        atc: l.atc || null,
        side: l.side || null,
      })
    }
    return out
  }, [lines, isPayroll])

  const totals = useMemo(() => {
    if (!profile.data || 'error' in parsedLines || isGJ || isPayroll) return null
    const party = (parties.data ?? []).find((p) => p.id === partyId)
    try {
      return deriveDocumentTotals(
        {
          profile: profile.data,
          direction: isSale ? 'sale' : 'purchase',
          date,
          counterpartyClass: party?.payeeClass ?? 'corporation',
          counterpartyIsGovernment: party?.isGovernment ?? false,
        },
        parsedLines.map((l) => ({
          amount: Money.fromCentavos(l.amountCentavos),
          amountIsVatInclusive: l.amountIsVatInclusive,
          vatClass: l.vatClass,
          atc: l.atc,
        })),
      ).totals
    } catch {
      return null
    }
  }, [profile.data, parsedLines, parties.data, partyId, date, isSale, isGJ, isPayroll])

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  const buildSheet = (): Sheet | { error: string } => {
    if ('error' in parsedLines) return parsedLines
    if (parsedLines.length === 0) return { error: 'Nothing to save — the sheet is empty' }
    if (!documentNo) return { error: 'Document number is required' }
    return {
      id: `${companyId}:${sheetType}:${documentNo}`,
      companyId,
      type: sheetType,
      documentNo,
      date,
      partyId: partyId || null,
      memo: '',
      lines: parsedLines,
      status: 'draft',
      postedEntryId: null,
      bankAccountCode: null,
      payrollPeriod: isPayroll ? { from: date, to: date } : null,
    }
  }

  const saveDraft = async () => {
    const s = buildSheet()
    if ('error' in s) return setMessage({ kind: 'error', text: s.error })
    await dataPort().sheets.saveDraft(s)
    invalidate(companyId)
    setMessage({ kind: 'ok', text: `Draft ${s.documentNo} saved` })
  }

  const post = async () => {
    const s = buildSheet()
    if ('error' in s) return setMessage({ kind: 'error', text: s.error })
    if (!profile.data) return setMessage({ kind: 'error', text: 'No tax profile in force on this date' })
    try {
      assertPostingAllowed(s.date, locks.data ?? [])
      const port = dataPort()
      await port.sheets.saveDraft(s)
      const entryNo = await port.journal.nextEntryNo(companyId)
      const entry = postSheet(s, {
        profile: profile.data,
        accounts: indexAccounts(accounts.data ?? []),
        party: (parties.data ?? []).find((p) => p.id === s.partyId) ?? null,
        entryId: `${companyId}:je:${entryNo}`,
        entryNo,
        postedAt: new Date().toISOString(),
      })
      await port.journal.append(entry)
      await port.sheets.markPosted(s.id, entry.id)
      invalidate(companyId)
      setLines([emptyLine(), emptyLine(), emptyLine()])
      setDocumentNo('')
      setMessage({ kind: 'ok', text: `${s.documentNo} posted as entry #${entryNo}` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const existing = (sheets.data ?? []).filter((s) => s.type === sheetType)

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold">{SHEET_TYPE_LABELS[sheetType]}</h1>
          <p className="text-sm text-slate-500">
            Draft until posted — posting writes one balanced, immutable journal entry.
          </p>
        </div>
      </header>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Document №</span>
            <input
              value={documentNo}
              onChange={(e) => setDocumentNo(e.target.value)}
              placeholder="SI-0001"
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          {!isGJ && !isPayroll && (
            <label className="flex min-w-56 flex-col">
              <span className="text-xs text-slate-500">{isSale ? 'Customer' : 'Supplier'}</span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5"
              >
                <option value="">—</option>
                {(parties.data ?? [])
                  .filter((p) => (isSale ? p.isCustomer : p.isSupplier) || true)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.registeredName}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>

        <SheetGrid
          lines={lines}
          onChange={setLines}
          columns={columns}
          accountOptions={accountOptions}
          atcOptions={atcOptions}
        />

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Tab to move, Enter for a new row, paste straight from Excel.
          </p>
          {totals && (
            <div className="flex gap-4 text-sm">
              <span>Net {totals.net.format()}</span>
              <span>VAT {totals.vat.format()}</span>
              <span>W/tax {totals.withholdingTotal.format()}</span>
              <span className="font-semibold">Due {totals.amountDue.format()}</span>
            </div>
          )}
        </div>

        {message && (
          <p className={`mt-2 text-sm ${message.kind === 'ok' ? 'text-brand-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void saveDraft()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Save draft
          </button>
          <button
            onClick={() => void post()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Post to ledger
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">
          Existing {SHEET_TYPE_LABELS[sheetType].toLowerCase()}s
        </h2>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Document №</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Lines</th>
              </tr>
            </thead>
            <tbody>
              {existing.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-slate-400">
                    None yet.
                  </td>
                </tr>
              )}
              {existing.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{s.date}</td>
                  <td className="px-3 py-2 font-medium">{s.documentNo}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        s.status === 'posted'
                          ? 'bg-brand-50 text-brand-700'
                          : s.status === 'void'
                            ? 'bg-slate-100 text-slate-500'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{s.lines.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
