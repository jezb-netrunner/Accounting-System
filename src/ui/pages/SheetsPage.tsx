import { useQuery } from '@tanstack/react-query'
import { useBlocker, useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dataPort } from '../../data'
import { auditEvent } from '../../domain/audit'
import { atcCodeToRule } from '../../domain/masterData'
import {
  draftCorrectionCopy,
  postSheetDocument,
  reverseSheetEntry,
} from '../../domain/postingService'
import {
  SHEET_TYPE_LABELS,
  isSaleSheet,
  type Sheet,
  type SheetLine,
  type SheetType,
} from '../../domain/sheets'
import { Money } from '../../lib/money'
import { deriveDocumentTotals, deriveLineTax } from '../../tax/engine/lineTax'
import { computePayrollWithholding } from '../../tax/engine/withholdingPeriod'
import { rules } from '../../tax/rules'
import { SheetGrid, type GridColumn } from '../sheets/SheetGrid'
import { useCompanyData, useInvalidateCompany, useSelectedCompanyId } from '../state/company'

/**
 * Sheet entry. One grid component, specialized per sheet type: live per-line
 * tax derivation in a read-only column, running totals in the footer,
 * Ctrl/Cmd+Enter to post. Drafts save/delete freely; document numbers are
 * reserved from the numbering series at post time; posted documents open
 * read-only.
 */

interface EditableLine {
  description: string
  accountCode: string
  employeeId: string
  amount: string
  vatClass: 'vatable' | 'exempt' | 'zero_rated'
  atc: string
  side: '' | 'debit' | 'credit'
  otherTaxable: string
  thirteenth: string
  deMinimis: string
  contributions: string
}

const emptyLine = (): EditableLine => ({
  description: '',
  accountCode: '',
  employeeId: '',
  amount: '',
  vatClass: 'vatable',
  atc: '',
  side: '',
  otherTaxable: '',
  thirteenth: '',
  deMinimis: '',
  contributions: '',
})

const today = () => new Date().toISOString().slice(0, 10)

const parseAmount = (s: string): number | null => {
  if (!s.trim()) return null
  try {
    return Money.parse(s).centavos
  } catch {
    return null
  }
}

const amountError = (s: string): string | null =>
  s.trim() === '' || parseAmount(s) !== null ? null : `"${s}" is not a peso amount`

interface EditorState {
  sheetId: string | null // null until first save
  date: string
  documentNo: string
  partyId: string
  bankAccountCode: string
  memo: string
  payrollFrequency: 'monthly' | 'semi_monthly' | 'weekly' | 'daily'
  payrollFrom: string
  payrollTo: string
  lines: EditableLine[]
  readOnly: boolean
}

const freshEditor = (): EditorState => ({
  sheetId: null,
  date: today(),
  documentNo: '',
  partyId: '',
  bankAccountCode: '',
  memo: '',
  payrollFrequency: 'monthly',
  payrollFrom: today(),
  payrollTo: today(),
  lines: [emptyLine(), emptyLine(), emptyLine()],
  readOnly: false,
})

export function SheetsPage() {
  const { sheetType } = useParams({ from: '/app/sheets/$sheetType' }) as { sheetType: SheetType }
  const { open } = useSearch({ from: '/app/sheets/$sheetType' }) as { open?: string }
  const companyId = useSelectedCompanyId()
  const { accounts, profile, parties, sheets, locks, entries } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()

  const employeesQ = useQuery({
    queryKey: ['employees', companyId],
    queryFn: () => dataPort().employees.list(companyId!),
    enabled: !!companyId,
  })
  const banksQ = useQuery({
    queryKey: ['bankAccounts', companyId],
    queryFn: () => dataPort().bankAccounts.list(companyId!),
    enabled: !!companyId,
  })
  const atcCodesQ = useQuery({
    queryKey: ['atcCodes', companyId],
    queryFn: () => dataPort().atcCodes.list(companyId!),
    enabled: !!companyId,
  })
  const numberingQ = useQuery({
    queryKey: ['numbering', companyId],
    queryFn: () => dataPort().numbering.list(companyId!),
    enabled: !!companyId,
  })

  const [editor, setEditor] = useState<EditorState>(freshEditor)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // Reset the editor when switching sheet types.
  useEffect(() => {
    setEditor(freshEditor())
    setDirty(false)
    setMessage(null)
  }, [sheetType, companyId])

  // Deep link from ledger drill-through: /app/sheets/<type>?open=<sheetId>
  const openedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open || openedRef.current === open) return
    const s = (sheets.data ?? []).find((x) => x.id === open)
    if (s) {
      openedRef.current = open
      openSheet(s)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheets.data])

  // Unsaved-change guards: tab close + in-app navigation.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])
  useBlocker({
    shouldBlockFn: () => {
      if (!dirtyRef.current) return false
      return !window.confirm('You have unsaved changes on this sheet. Leave anyway?')
    },
    enableBeforeUnload: false,
  })

  const isSale = isSaleSheet(sheetType)
  const isGJ = sheetType === 'general_journal'
  const isPayroll = sheetType === 'payroll_register'
  const isSettlement = sheetType === 'collection' || sheetType === 'disbursement'

  const customAtcRates = useMemo(
    () => (atcCodesQ.data ?? []).filter((a) => a.active).map(atcCodeToRule),
    [atcCodesQ.data],
  )

  const party = (parties.data ?? []).find((p) => p.id === editor.partyId) ?? null

  const atcOptions = useMemo(() => {
    const payeeClass = party?.payeeClass ?? 'corporation'
    const builtIn = rules
      .atcsForPayee(editor.date, payeeClass)
      .map((r) => ({ value: r.atc, label: `${r.atc} — ${r.natureOfPayment}` }))
    const custom = customAtcRates
      .filter((r) => r.payeeClass === payeeClass)
      .map((r) => ({ value: r.atc, label: `${r.atc} — ${r.natureOfPayment}` }))
    return [{ value: '', label: 'No withholding' }, ...builtIn, ...custom]
  }, [editor.date, party?.payeeClass, customAtcRates])

  const accountOptions = useMemo(
    () => [
      { value: '', label: '(default account)' },
      ...(accounts.data ?? [])
        .filter((a) => a.postable && a.active)
        .map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
    ],
    [accounts.data],
  )

  const employeeOptions = useMemo(
    () => [
      { value: '', label: '— pick employee —' },
      ...(employeesQ.data ?? [])
        .filter((e) => e.active)
        .map((e) => ({ value: e.id, label: `${e.employeeNo} · ${e.lastName}, ${e.firstName}` })),
    ],
    [employeesQ.data],
  )

  const series = (numberingQ.data ?? []).find((n) => n.documentType === sheetType) ?? null

  // ---- Per-line derivation for the read-only column ----
  const taxCtx = useMemo(
    () =>
      profile.data
        ? {
            profile: profile.data,
            direction: (isSale ? 'sale' : 'purchase') as 'sale' | 'purchase',
            date: editor.date,
            counterpartyClass: party?.payeeClass ?? ('corporation' as const),
            counterpartyIsGovernment: party?.isGovernment ?? false,
            customAtcRates,
          }
        : null,
    [profile.data, isSale, editor.date, party, customAtcRates],
  )

  const deriveCell = (l: EditableLine): string => {
    const cents = parseAmount(l.amount)
    if (cents === null || cents === 0 || !taxCtx) return ''
    if (isPayroll) {
      const r = payrollResult(l, editor)
      return r ? `W/tax ${r.withholding.format()}` : ''
    }
    try {
      const d = deriveLineTax(taxCtx, {
        amount: Money.fromCentavos(cents),
        amountIsVatInclusive: true,
        vatClass: l.vatClass,
        atc: l.atc || null,
      })
      const parts: string[] = []
      if (!d.vat.isZero()) parts.push(`VAT ${d.vat.format()}`)
      if (d.withholding) parts.push(`WHT ${d.withholding.amount.format()}`)
      return parts.join(' · ') || '—'
    } catch {
      return ''
    }
  }

  const payrollResult = (l: EditableLine, ed: EditorState) => {
    const basic = parseAmount(l.amount)
    if (basic === null) return null
    try {
      return computePayrollWithholding(
        {
          frequency: ed.payrollFrequency,
          basicPay: Money.fromCentavos(basic),
          otherTaxable: Money.fromCentavos(parseAmount(l.otherTaxable) ?? 0),
          thirteenthMonthAndOtherBenefits: Money.fromCentavos(parseAmount(l.thirteenth) ?? 0),
          thirteenthMonthYtdBefore: Money.ZERO,
          deMinimis: [],
          mandatoryContributions: Money.fromCentavos(parseAmount(l.contributions) ?? 0),
        },
        ed.date,
      )
    } catch {
      return null
    }
  }

  // ---- Column configs per sheet type ----
  const columns = useMemo((): GridColumn<EditableLine>[] => {
    const text = (key: keyof EditableLine, header: string, width?: string): GridColumn<EditableLine> => ({
      key,
      header,
      width,
      kind: 'text',
      get: (r) => r[key],
      set: (r, v) => ({ ...r, [key]: v }),
    })
    const amount = (key: keyof EditableLine, header: string): GridColumn<EditableLine> => ({
      key,
      header,
      width: '110px',
      kind: 'amount',
      get: (r) => r[key],
      set: (r, v) => ({ ...r, [key]: v }),
      validate: amountError,
    })
    const select = (
      key: keyof EditableLine,
      header: string,
      options: readonly { value: string; label: string }[],
      width?: string,
    ): GridColumn<EditableLine> => ({
      key,
      header,
      width,
      kind: 'select',
      options,
      get: (r) => r[key],
      set: (r, v) => ({ ...r, [key]: v }),
      validate: (v) => (v === '' || options.some((o) => o.value === v) ? null : `"${v}" is not an option`),
    })
    const derived: GridColumn<EditableLine> = {
      key: 'derived',
      header: 'Tax (derived)',
      width: '170px',
      kind: 'derived',
      get: deriveCell,
    }

    if (isGJ) {
      return [
        text('description', 'Particulars'),
        select('accountCode', 'Account', accountOptions, '220px'),
        select(
          'side',
          'Dr/Cr',
          [
            { value: '', label: '—' },
            { value: 'debit', label: 'Debit' },
            { value: 'credit', label: 'Credit' },
          ],
          '90px',
        ),
        amount('amount', 'Amount'),
      ]
    }
    if (isPayroll) {
      return [
        select('employeeId', 'Employee', employeeOptions, '220px'),
        amount('amount', 'Basic pay'),
        amount('otherTaxable', 'Other taxable'),
        amount('thirteenth', '13th mo. & benefits'),
        amount('deMinimis', 'De minimis'),
        amount('contributions', 'SSS/PH/HDMF (EE)'),
        derived,
      ]
    }
    if (isSettlement) {
      return [
        text('description', 'Particulars'),
        select('accountCode', 'Account', accountOptions, '220px'),
        amount('amount', 'Amount'),
        ...(sheetType === 'disbursement'
          ? [
              select('vatClass', 'VAT class', VAT_CLASS_OPTIONS, '110px'),
              select('atc', 'ATC', atcOptions, '170px'),
              derived,
            ]
          : []),
      ]
    }
    return [
      text('description', 'Description'),
      select('accountCode', 'Account', accountOptions, '200px'),
      amount('amount', 'Amount (gross)'),
      select('vatClass', 'VAT class', VAT_CLASS_OPTIONS, '110px'),
      select('atc', 'ATC', atcOptions, '170px'),
      derived,
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGJ, isPayroll, isSettlement, sheetType, accountOptions, atcOptions, employeeOptions, taxCtx, editor])

  // ---- Parse editor rows into domain SheetLines ----
  const parsedLines = useMemo((): SheetLine[] | { error: string } => {
    const out: SheetLine[] = []
    for (const [i, l] of editor.lines.entries()) {
      const blank = !l.description && !l.amount && !l.employeeId
      if (blank) continue
      const cents = parseAmount(l.amount)
      if (cents === null) return { error: `Line ${i + 1}: "${l.amount}" is not a valid amount` }
      if (isGJ && (!l.accountCode || !l.side)) {
        return { error: `Line ${i + 1}: general journal lines need an account and a side` }
      }
      if (isPayroll && !l.employeeId) {
        return { error: `Line ${i + 1}: pick the employee` }
      }
      const employee = (employeesQ.data ?? []).find((e) => e.id === l.employeeId)
      out.push({
        lineNo: i + 1,
        description: isPayroll
          ? employee
            ? `${employee.lastName}, ${employee.firstName}`
            : l.description
          : l.description,
        accountCode: l.accountCode || null,
        itemId: null,
        employeeId: l.employeeId || null,
        quantity: null,
        amountCentavos: cents,
        amountIsVatInclusive: true,
        vatClass: isPayroll ? 'exempt' : l.vatClass,
        atc: l.atc || null,
        side: l.side || null,
        ...(isPayroll
          ? {
              payroll: {
                otherTaxableCentavos: parseAmount(l.otherTaxable) ?? 0,
                thirteenthMonthCentavos: parseAmount(l.thirteenth) ?? 0,
                deMinimisCentavos: parseAmount(l.deMinimis) ?? 0,
                mandatoryContributionsCentavos: parseAmount(l.contributions) ?? 0,
              },
            }
          : {}),
      })
    }
    return out
  }, [editor.lines, isGJ, isPayroll, employeesQ.data])

  // ---- Footer totals ----
  const footer = useMemo(() => {
    if ('error' in parsedLines) {
      return (
        <tr>
          <td colSpan={columns.length + 2} className="border border-slate-200 bg-red-50 px-3 py-1.5 text-sm text-red-600">
            {parsedLines.error}
          </td>
        </tr>
      )
    }
    const cell = (label: string, value: string, strong = false) => (
      <span className="ml-4 first:ml-0">
        <span className="text-xs uppercase text-slate-400">{label} </span>
        <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span>
      </span>
    )
    let content: React.ReactNode = null
    if (isGJ) {
      const dr = parsedLines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amountCentavos, 0)
      const cr = parsedLines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amountCentavos, 0)
      content = (
        <>
          {cell('Debits', Money.fromCentavos(dr).format())}
          {cell('Credits', Money.fromCentavos(cr).format())}
          {dr === cr ? (
            <span className="ml-4 text-brand-600">balanced ✓</span>
          ) : (
            cell('Off by', Money.fromCentavos(Math.abs(dr - cr)).format(), true)
          )}
        </>
      )
    } else if (isPayroll) {
      let gross = 0
      let wtax = Money.ZERO
      let contrib = 0
      for (const l of editor.lines) {
        const r = payrollResult(l, editor)
        if (!r) continue
        gross +=
          (parseAmount(l.amount) ?? 0) +
          (parseAmount(l.otherTaxable) ?? 0) +
          (parseAmount(l.thirteenth) ?? 0) +
          (parseAmount(l.deMinimis) ?? 0)
        wtax = wtax.add(r.withholding)
        contrib += parseAmount(l.contributions) ?? 0
      }
      content = (
        <>
          {cell('Gross', Money.fromCentavos(gross).format())}
          {cell('W/tax', wtax.format())}
          {cell('Contributions', Money.fromCentavos(contrib).format())}
          {cell('Net pay', Money.fromCentavos(gross).subtract(wtax).subtract(Money.fromCentavos(contrib)).format(), true)}
        </>
      )
    } else if (isSettlement) {
      const total = parsedLines.reduce((a, l) => a + l.amountCentavos, 0)
      content = cell('Total', Money.fromCentavos(total).format(), true)
    } else if (taxCtx) {
      try {
        const { totals } = deriveDocumentTotals(
          taxCtx,
          parsedLines.map((l) => ({
            amount: Money.fromCentavos(l.amountCentavos),
            amountIsVatInclusive: l.amountIsVatInclusive,
            vatClass: l.vatClass,
            atc: l.atc,
          })),
        )
        content = (
          <>
            {cell('Gross', totals.gross.format())}
            {cell('Net', totals.net.format())}
            {cell('VAT', totals.vat.format())}
            {cell('W/tax', totals.withholdingTotal.add(totals.governmentVatWithheld).format())}
            {cell('Due', totals.amountDue.format(), true)}
          </>
        )
      } catch (err) {
        content = <span className="text-red-600">{err instanceof Error ? err.message : String(err)}</span>
      }
    }
    return (
      <tr>
        <td colSpan={columns.length + 2} className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-right text-sm">
          {content}
        </td>
      </tr>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedLines, columns.length, isGJ, isPayroll, isSettlement, taxCtx, editor])

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  // ---- Draft lifecycle ----
  const buildSheet = (): Sheet | { error: string } => {
    if ('error' in parsedLines) return parsedLines
    if (parsedLines.length === 0) return { error: 'Nothing to save — the sheet is empty' }
    return {
      id: editor.sheetId ?? `${companyId}:${sheetType}:${crypto.randomUUID()}`,
      companyId,
      type: sheetType,
      documentNo: editor.documentNo,
      date: editor.date,
      partyId: editor.partyId || null,
      memo: editor.memo,
      lines: parsedLines,
      status: 'draft',
      postedEntryId: null,
      bankAccountCode: editor.bankAccountCode || null,
      payrollPeriod: isPayroll ? { from: editor.payrollFrom, to: editor.payrollTo } : null,
      ...(isPayroll ? { payrollFrequency: editor.payrollFrequency } : {}),
    }
  }

  const saveDraft = async () => {
    const s = buildSheet()
    if ('error' in s) return setMessage({ kind: 'error', text: s.error })
    const port = dataPort()
    const before = editor.sheetId ? await port.sheets.get(editor.sheetId) : null
    await port.sheets.saveDraft(s)
    await port.audit.append(
      auditEvent(companyId, 'draft_saved', `sheet:${s.id}`, `${SHEET_TYPE_LABELS[sheetType]} draft saved`, {
        before: before ?? undefined,
        after: s,
      }),
    )
    setEditor((e) => ({ ...e, sheetId: s.id }))
    setDirty(false)
    invalidate(companyId)
    setMessage({ kind: 'ok', text: `Draft saved${s.documentNo ? ` (${s.documentNo})` : ''}` })
  }

  const deleteDraft = async () => {
    if (!editor.sheetId) return
    if (!window.confirm('Delete this draft?')) return
    const port = dataPort()
    const before = await port.sheets.get(editor.sheetId)
    await port.sheets.deleteDraft(editor.sheetId)
    await port.audit.append(
      auditEvent(companyId, 'draft_deleted', `sheet:${editor.sheetId}`, `${SHEET_TYPE_LABELS[sheetType]} draft deleted`, {
        before: before ?? undefined,
      }),
    )
    setEditor(freshEditor())
    setDirty(false)
    invalidate(companyId)
    setMessage({ kind: 'ok', text: 'Draft deleted' })
  }

  const currentSheet = editor.sheetId ? (sheets.data ?? []).find((s) => s.id === editor.sheetId) : null
  const postedEntry = currentSheet?.postedEntryId
    ? (entries.data ?? []).find((e) => e.id === currentSheet.postedEntryId)
    : null
  const reversalOfPosted = postedEntry
    ? (entries.data ?? []).find((e) => e.reversalOfEntryId === postedEntry.id)
    : null

  const reversePosted = async () => {
    if (!postedEntry) return
    const reason = window.prompt('Reason for the reversal?')
    if (!reason) return
    try {
      const reversal = await reverseSheetEntry(dataPort(), {
        original: postedEntry,
        reason,
        date: today(),
        locks: locks.data ?? [],
        now: new Date().toISOString(),
      })
      invalidate(companyId)
      setMessage({ kind: 'ok', text: `Reversed by entry #${reversal.entryNo}` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const correctPosted = async () => {
    if (!currentSheet || !postedEntry) return
    const reason = window.prompt('Reason for the correction? (reverses, then drafts a copy)')
    if (!reason) return
    try {
      await reverseSheetEntry(dataPort(), {
        original: postedEntry,
        reason,
        date: today(),
        locks: locks.data ?? [],
        now: new Date().toISOString(),
      })
      const copy = await draftCorrectionCopy(dataPort(), currentSheet)
      invalidate(companyId)
      openSheet(copy)
      setMessage({ kind: 'ok', text: `Reversed ${currentSheet.documentNo}; edit and post the correction below` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const post = async () => {
    const s = buildSheet()
    if ('error' in s) return setMessage({ kind: 'error', text: s.error })
    if (!profile.data) return setMessage({ kind: 'error', text: 'No tax profile in force on this date' })
    try {
      const { documentNo, entry } = await postSheetDocument(dataPort(), {
        sheet: s,
        profile: profile.data,
        accounts: accounts.data ?? [],
        party,
        locks: locks.data ?? [],
        customAtcRates,
        now: new Date().toISOString(),
        seriesId: series?.id ?? null,
      })
      setEditor(freshEditor())
      setDirty(false)
      invalidate(companyId)
      setMessage({ kind: 'ok', text: `${documentNo} posted as entry #${entry.entryNo}` })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const openSheet = (s: Sheet) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setMessage(null)
    setEditor({
      sheetId: s.id,
      date: s.date,
      documentNo: s.documentNo,
      partyId: s.partyId ?? '',
      bankAccountCode: s.bankAccountCode ?? '',
      memo: s.memo,
      payrollFrequency: s.payrollFrequency ?? 'monthly',
      payrollFrom: s.payrollPeriod?.from ?? s.date,
      payrollTo: s.payrollPeriod?.to ?? s.date,
      lines: s.lines.map((l) => ({
        description: l.description,
        accountCode: l.accountCode ?? '',
        employeeId: l.employeeId ?? '',
        amount: Money.fromCentavos(l.amountCentavos).format().replace(/,/g, ''),
        vatClass: l.vatClass,
        atc: l.atc ?? '',
        side: l.side ?? '',
        otherTaxable: l.payroll ? centavosToInput(l.payroll.otherTaxableCentavos) : '',
        thirteenth: l.payroll ? centavosToInput(l.payroll.thirteenthMonthCentavos) : '',
        deMinimis: l.payroll ? centavosToInput(l.payroll.deMinimisCentavos) : '',
        contributions: l.payroll ? centavosToInput(l.payroll.mandatoryContributionsCentavos) : '',
      })),
      readOnly: s.status !== 'draft',
    })
    setDirty(false)
  }

  const existing = (sheets.data ?? []).filter((s) => s.type === sheetType)
  const setLines = (lines: EditableLine[]) => {
    setEditor((e) => ({ ...e, lines }))
    setDirty(true)
  }
  const setField = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setEditor((e) => ({ ...e, [key]: value }))
    setDirty(true)
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold">{SHEET_TYPE_LABELS[sheetType]}</h1>
          <p className="text-sm text-slate-500">
            {editor.readOnly
              ? 'Posted — immutable. Corrections happen by reversal in the ledger.'
              : 'Draft until posted — posting reserves the document number and writes one balanced, immutable journal entry.'}
          </p>
        </div>
        {(editor.sheetId || dirty) && (
          <button
            onClick={() => {
              if (dirty && !window.confirm('Discard unsaved changes?')) return
              setEditor(freshEditor())
              setDirty(false)
              setMessage(null)
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-white"
          >
            + New {SHEET_TYPE_LABELS[sheetType].toLowerCase()}
          </button>
        )}
      </header>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Date</span>
            <input
              type="date"
              value={editor.date}
              disabled={editor.readOnly}
              onChange={(e) => setField('date', e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Document №</span>
            <input
              value={editor.documentNo}
              disabled={editor.readOnly}
              onChange={(e) => setField('documentNo', e.target.value)}
              placeholder={series ? `auto on post (next: ${series.prefix}${String(series.nextNumber).padStart(series.padding, '0')})` : 'type a number'}
              className="w-56 rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          {!isGJ && !isPayroll && (
            <label className="flex min-w-56 flex-col">
              <span className="text-xs text-slate-500">{isSale || sheetType === 'collection' ? 'Customer' : 'Supplier'}</span>
              <select
                value={editor.partyId}
                disabled={editor.readOnly}
                onChange={(e) => setField('partyId', e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5"
              >
                <option value="">—</option>
                {(parties.data ?? [])
                  .filter((p) => p.active && !p.mergedIntoId)
                  .filter((p) => (isSale || sheetType === 'collection' ? p.isCustomer : p.isSupplier))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.registeredName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {isSettlement && (
            <label className="flex min-w-48 flex-col">
              <span className="text-xs text-slate-500">Bank / cash account</span>
              <select
                value={editor.bankAccountCode}
                disabled={editor.readOnly}
                onChange={(e) => setField('bankAccountCode', e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5"
              >
                <option value="">Cash on hand (default)</option>
                {(banksQ.data ?? [])
                  .filter((b) => b.active)
                  .map((b) => (
                    <option key={b.id} value={b.glAccountCode}>
                      {b.bankName} · {b.accountNo}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {isPayroll && (
            <>
              <label className="flex flex-col">
                <span className="text-xs text-slate-500">Period from</span>
                <input type="date" value={editor.payrollFrom} disabled={editor.readOnly} onChange={(e) => setField('payrollFrom', e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-slate-500">Period to</span>
                <input type="date" value={editor.payrollTo} disabled={editor.readOnly} onChange={(e) => setField('payrollTo', e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-slate-500">Frequency (withholding table)</span>
                <select
                  value={editor.payrollFrequency}
                  disabled={editor.readOnly}
                  onChange={(e) => setField('payrollFrequency', e.target.value as EditorState['payrollFrequency'])}
                  className="rounded-md border border-slate-300 px-2 py-1.5"
                >
                  <option value="monthly">Monthly</option>
                  <option value="semi_monthly">Semi-monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </label>
            </>
          )}
          <label className="flex min-w-48 flex-1 flex-col">
            <span className="text-xs text-slate-500">Memo</span>
            <input
              value={editor.memo}
              disabled={editor.readOnly}
              onChange={(e) => setField('memo', e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
        </div>

        <SheetGrid
          rows={editor.lines}
          columns={columns}
          onChange={setLines}
          emptyRow={emptyLine}
          footer={footer}
          readOnly={editor.readOnly}
          onPost={() => void post()}
        />

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Arrows/Tab to move · Enter commits and moves down · paste a block straight from Excel ·{' '}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Ctrl</kbd>+
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Enter</kbd> posts
          </p>
          {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
        </div>

        {message && (
          <p className={`mt-2 text-sm ${message.kind === 'ok' ? 'text-brand-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}

        {!editor.readOnly && (
          <div className="mt-4 flex gap-2">
            <button onClick={() => void saveDraft()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
              Save draft
            </button>
            <button onClick={() => void post()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Post to ledger
            </button>
            {editor.sheetId && (
              <button onClick={() => void deleteDraft()} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                Delete draft
              </button>
            )}
          </div>
        )}

        {editor.readOnly && currentSheet && (
          <div className="mt-4 flex items-center gap-2">
            {postedEntry && (
              <span className="text-sm text-slate-500">
                Posted as entry <span className="font-medium">#{postedEntry.entryNo}</span>
              </span>
            )}
            {reversalOfPosted ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Reversed by entry #{reversalOfPosted.entryNo}
              </span>
            ) : (
              <>
                <button onClick={() => void reversePosted()} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                  Reverse…
                </button>
                <button onClick={() => void correctPosted()} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                  Correct (reverse &amp; re-draft)…
                </button>
              </>
            )}
          </div>
        )}
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
                <th className="px-3 py-2">Party</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Lines</th>
              </tr>
            </thead>
            <tbody>
              {existing.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-400">
                    None yet.
                  </td>
                </tr>
              )}
              {existing.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => openSheet(s)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${s.id === editor.sheetId ? 'bg-brand-50/50' : ''}`}
                >
                  <td className="px-3 py-2">{s.date}</td>
                  <td className="px-3 py-2 font-medium">{s.documentNo || <span className="text-slate-400">(draft)</span>}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {(parties.data ?? []).find((p) => p.id === s.partyId)?.registeredName ?? '—'}
                  </td>
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
                  <td className="px-3 py-2 text-right text-slate-500">{s.lines.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const VAT_CLASS_OPTIONS = [
  { value: 'vatable', label: 'VATable' },
  { value: 'exempt', label: 'Exempt' },
  { value: 'zero_rated', label: 'Zero-rated' },
] as const

const centavosToInput = (c: number): string => (c === 0 ? '' : Money.fromCentavos(c).format().replace(/,/g, ''))
