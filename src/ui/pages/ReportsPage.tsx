import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import { auditEvent } from '../../domain/audit'
import {
  addMonths,
  fiscalQuarterOf,
  formatTIN,
  periodOfDate,
  type Period,
} from '../../domain/core'
import { atcCodeToRule } from '../../domain/masterData'
import { Money } from '../../lib/money'
import {
  alphalistDraftCsv,
  qapDraftCsv,
  sawtDraftCsv,
  slspDraftCsv,
} from '../../reports/attachments/datWriter'
import { FORMAT_SPECS } from '../../reports/attachments/formatSpecs'
import type { Form2307, Form2316 } from '../../reports/certificates'
import {
  build2306Certificates,
  build2307Certificates,
  build2316Certificates,
  buildAnnualAlphalist,
  buildQap,
  buildReturn0619,
  buildReturn1601C,
  buildReturn1601Q,
  buildReturn1701,
  buildReturn1701Q,
  buildReturn1702,
  buildReturn1702Q,
  buildReturn2550Q,
  buildReturn2551Q,
  buildReturn1604,
  buildSawt,
  buildSlsp,
  type BuiltReturn,
} from '../../reports/returns/build'
import type { GeneratedReturn, ReturnContext } from '../../reports/returns/context'
import { availableForms } from '../../reports/returns/registry'
import { filingCalendarRange } from '../../tax/filingCalendar'
import { useCompanyData, useInvalidateCompany, useSelectedCompanyId } from '../state/company'

/**
 * Returns & filings: the derived filing calendar over a date range, a
 * prepare-and-review flow mapping computed figures onto each form's line
 * items, submission files (JSON now; .DAT/XML refuse until their layouts
 * are verified — see docs/bir-formats/), and the 2307/2306/2316
 * certificates with print views.
 */

type Tab = 'calendar' | 'prepare' | 'certificates'

const now = new Date()
const thisYear = now.getFullYear()

const download = (filename: string, content: string, mime = 'application/json') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: mime }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

interface ReviewRow {
  label: string
  value: string
  strong?: boolean
}

export function ReportsPage() {
  const companyId = useSelectedCompanyId()
  const { profile, entries, accounts, sheets, parties } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()
  const [tab, setTab] = useState<Tab>('calendar')

  const companyQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => dataPort().companies.get(companyId!),
    enabled: !!companyId,
  })
  const employeesQ = useQuery({
    queryKey: ['employees', companyId],
    queryFn: () => dataPort().employees.list(companyId!),
    enabled: !!companyId,
  })
  const atcCodesQ = useQuery({
    queryKey: ['atcCodes', companyId],
    queryFn: () => dataPort().atcCodes.list(companyId!),
    enabled: !!companyId,
  })
  const generatedQ = useQuery({
    queryKey: ['generatedReturns', companyId],
    queryFn: () => dataPort().generatedReturns.list(companyId!),
    enabled: !!companyId,
  })

  const ctx = useMemo((): ReturnContext | null => {
    if (!companyQ.data || !profile.data) return null
    return {
      company: companyQ.data,
      profile: profile.data,
      entries: entries.data ?? [],
      sheets: sheets.data ?? [],
      parties: parties.data ?? [],
      employees: employeesQ.data ?? [],
      accounts: accounts.data ?? [],
      customAtcRates: (atcCodesQ.data ?? []).filter((a) => a.active).map(atcCodeToRule),
      priorReturns: generatedQ.data ?? [],
    }
  }, [companyQ.data, profile.data, entries.data, sheets.data, parties.data, employeesQ.data, accounts.data, atcCodesQ.data, generatedQ.data])

  const [prepareForm, setPrepareForm] = useState<string>('')

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Returns &amp; filings</h1>
        <p className="text-sm text-slate-500">
          Everything derives from the tax profile — forms outside the registration never appear.
        </p>
      </header>
      <nav className="flex flex-wrap gap-1.5">
        {(
          [
            ['calendar', 'Filing calendar'],
            ['prepare', 'Prepare a return'],
            ['certificates', 'Certificates (2307 / 2306 / 2316)'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-sm ${tab === key ? 'bg-brand-600 font-medium text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'calendar' && ctx && (
        <CalendarTab
          ctx={ctx}
          generated={generatedQ.data ?? []}
          onPrepare={(formCode) => {
            setPrepareForm(formCode)
            setTab('prepare')
          }}
        />
      )}
      {tab === 'prepare' && ctx && (
        <PrepareTab
          ctx={ctx}
          companyId={companyId}
          initialForm={prepareForm}
          generated={generatedQ.data ?? []}
          onGenerated={() => invalidate(companyId)}
        />
      )}
      {tab === 'certificates' && ctx && <CertificatesTab ctx={ctx} />}
    </div>
  )
}

// ---------------- Filing calendar ----------------

function CalendarTab({
  ctx,
  generated,
  onPrepare,
}: {
  ctx: ReturnContext
  generated: GeneratedReturn[]
  onPrepare(formCode: string): void
}) {
  const [fromMonth, setFromMonth] = useState(`${thisYear}-01`)
  const [toMonth, setToMonth] = useState(`${thisYear}-12`)
  const obligations = useMemo(() => {
    const parse = (s: string): Period => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) })
    try {
      return filingCalendarRange(ctx.profile, parse(fromMonth), parse(toMonth))
    } catch {
      return []
    }
  }, [ctx.profile, fromMonth, toMonth])

  const isGenerated = (formCode: string, periodTo: string) =>
    generated.some((g) => g.formCode === formCode && g.periodTo === periodTo)

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Obligations with deadlines in the range</h2>
        <div className="flex gap-2 text-sm">
          <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
        </div>
      </div>
      {obligations.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">Nothing due in this range under the current registration.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {obligations.map((o) => (
            <li key={`${o.formCode}-${o.periodCovered.from}`} className="flex items-center gap-4 py-2.5">
              <span className="w-24 shrink-0 rounded-md bg-brand-50 px-2 py-1 text-center text-sm font-semibold text-brand-700">
                {o.formCode}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{o.description}</p>
                <p className="text-xs text-slate-400">
                  {o.periodCovered.from} → {o.periodCovered.to}
                  {o.attachments.length > 0 && ` · with ${o.attachments.join(', ')}`}
                </p>
              </div>
              {isGenerated(o.formCode, o.periodCovered.to) && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">generated ✓</span>
              )}
              <span className="shrink-0 text-sm font-medium">due {o.deadline}</span>
              <button onClick={() => onPrepare(o.formCode)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">
                Prepare
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------- Prepare & review ----------------

const peso = (m: Money) => `₱ ${m.format()}`

function PrepareTab({
  ctx,
  companyId,
  initialForm,
  generated,
  onGenerated,
}: {
  ctx: ReturnContext
  companyId: string
  initialForm: string
  generated: GeneratedReturn[]
  onGenerated(): void
}) {
  const forms = availableForms(ctx.profile)
  const [formCode, setFormCode] = useState(initialForm || forms[0]?.formCode || '')
  const fq = fiscalQuarterOf(now.toISOString().slice(0, 10), ctx.profile.fiscalYearEndMonth)
  const prevQ = fiscalQuarterOf(addMonthsIso(fq.startDate, -1), ctx.profile.fiscalYearEndMonth)
  const [from, setFrom] = useState(prevQ.startDate)
  const [to, setTo] = useState(prevQ.endDate)
  const [amortizedOverride, setAmortizedOverride] = useState('')
  const [assetsOverride, setAssetsOverride] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const built = useMemo((): {
    rows: ReviewRow[]
    figures: Record<string, number>
    model: unknown
    attachments: { label: string; csv: () => { filename: string; content: string }; datKind: string }[]
  } | null => {
    if (!formCode) return null
    try {
      return buildForReview(ctx, formCode, from, to, {
        amortizedInputVatCentavos: amortizedOverride ? Money.parse(amortizedOverride).centavos : 0,
        totalAssetsExclLandCentavos: assetsOverride ? Money.parse(assetsOverride).centavos : 0,
      })
    } catch (err) {
      return {
        rows: [{ label: 'Cannot build', value: err instanceof Error ? err.message : String(err) }],
        figures: {},
        model: null,
        attachments: [],
      }
    }
  }, [ctx, formCode, from, to, amortizedOverride, assetsOverride])

  const alreadyGenerated = generated.find((g) => g.formCode === formCode && g.periodTo === to)

  const saveGenerated = async () => {
    if (!built) return
    const port = dataPort()
    const record: GeneratedReturn = {
      id: `${companyId}:${formCode}:${to}`,
      companyId,
      formCode,
      periodFrom: from,
      periodTo: to,
      generatedAt: new Date().toISOString(),
      figures: built.figures,
    }
    await port.generatedReturns.save(record)
    await port.audit.append(
      auditEvent(companyId, 'return_generated', `return:${formCode}:${to}`, `${formCode} generated for ${from} → ${to}`),
    )
    onGenerated()
    setMessage(`${formCode} for ${from} → ${to} recorded as generated. Carry-forwards now see it.`)
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Form</span>
            <select value={formCode} onChange={(e) => setFormCode(e.target.value)} className="min-w-64 rounded-md border border-slate-300 px-2 py-1.5">
              {forms.map((f) => (
                <option key={f.formCode} value={f.formCode}>
                  {f.formCode} — {f.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Period from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Period to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          {formCode === '2550Q' && (
            <label className="flex flex-col">
              <span className="text-xs text-slate-500">
                Amortized input VAT from pre-2022 capital-goods schedules (₱; do NOT re-enter VAT already in this quarter's purchases)
              </span>
              <input value={amortizedOverride} onChange={(e) => setAmortizedOverride(e.target.value)} placeholder="0.00" className="rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
          )}
          {(formCode === '1702Q' || formCode.startsWith('1702-')) && (
            <label className="flex flex-col">
              <span className="text-xs text-slate-500">Total assets excl. land (₱, for the 20% test)</span>
              <input value={assetsOverride} onChange={(e) => setAssetsOverride(e.target.value)} placeholder="0.00" className="rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
          )}
        </div>
      </section>

      {built && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">
                {formCode} — {ctx.company.registeredName} ({formatTIN(ctx.company.tin)})
              </h2>
              <p className="text-xs text-slate-500">
                {from} → {to} · RDO {ctx.profile.rdoCode}
                {alreadyGenerated && ` · previously generated ${alreadyGenerated.generatedAt.slice(0, 10)}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => download(`${formCode}-${to}.json`, JSON.stringify(built.model, null, 2))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                Download JSON
              </button>
              <button onClick={() => void saveGenerated()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                {alreadyGenerated ? 'Regenerate' : 'Mark as generated'}
              </button>
            </div>
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            {built.rows.map((r, i) => (
              <div key={i} className={`flex justify-between py-1.5 ${r.strong ? 'font-semibold' : ''}`}>
                <dt className="pr-4 text-slate-600">{r.label}</dt>
                <dd className="tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>

          {built.attachments.length > 0 && (
            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-600">Attachments</h3>
              {built.attachments.map((a) => {
                const spec = FORMAT_SPECS[a.datKind]
                return (
                  <div key={a.label} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-40 font-medium">{a.label}</span>
                    <button
                      onClick={() => {
                        const f = a.csv()
                        download(f.filename, f.content, 'text/csv')
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-white"
                    >
                      Draft CSV (review only)
                    </button>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" title={spec?.notes}>
                      .DAT blocked — layout UNVERIFIED ({spec?.specFile})
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            eBIRForms/eFPS XML is likewise blocked until its field map is verified
            (docs/bir-formats/ebirforms-xml.md); the JSON download carries every computed line.
          </p>
          {message && <p className="mt-2 text-sm text-brand-700">{message}</p>}
        </section>
      )}
    </div>
  )
}

function addMonthsIso(date: string, n: number): string {
  const p = periodOfDate(date)
  const moved = addMonths(p, n)
  return `${moved.year}-${String(moved.month).padStart(2, '0')}-01`
}

function buildForReview(
  ctx: ReturnContext,
  formCode: string,
  from: string,
  to: string,
  overrides: { amortizedInputVatCentavos: number; totalAssetsExclLandCentavos: number },
) {
  const p = periodOfDate(to)
  const year = p.year
  const noAttachments: { label: string; csv: () => { filename: string; content: string }; datKind: string }[] = []

  const withFigures = <T,>(b: BuiltReturn<T>, rows: ReviewRow[], attachments = noAttachments) => ({
    rows,
    figures: b.figures,
    model: b.model,
    attachments,
  })

  switch (true) {
    case formCode === '2550Q': {
      const b = buildReturn2550Q(ctx, from, to, { amortizedInputVatCentavos: overrides.amortizedInputVatCentavos })
      const m = b.model
      return withFigures(
        b,
        [
          { label: 'VATable sales (net of VAT)', value: peso(m.vatableSales) },
          { label: 'Output VAT', value: peso(m.outputVat) },
          { label: 'Zero-rated sales', value: peso(m.zeroRatedSales) },
          { label: 'VAT-exempt sales', value: peso(m.exemptSales) },
          { label: 'Sales to government', value: peso(m.governmentSales) },
          { label: 'Input VAT carried over from previous period', value: peso(m.inputVatCarriedOver) },
          { label: 'Input VAT on current purchases', value: peso(m.inputVatCurrent) },
          { label: 'Input VAT on capital goods (amortized this quarter)', value: peso(m.inputVatOnCapitalGoods) },
          { label: 'Less: input VAT allocated to exempt sales (expensed)', value: peso(m.inputVatAllocatedToExempt) },
          { label: 'Creditable VAT withheld by government payors', value: peso(m.creditableVatWithheld) },
          { label: 'Net VAT payable', value: peso(m.netVatPayable), strong: true },
          { label: 'Excess input VAT to carry forward', value: peso(m.excessInputVatCarryForward), strong: true },
        ],
        [
          {
            label: 'SLSP (Summary List of Sales & Purchases)',
            csv: () => slspDraftCsv(buildSlsp(ctx, from, to)),
            datKind: 'SLSP',
          },
        ],
      )
    }
    case formCode === '2551Q': {
      const b = buildReturn2551Q(ctx, from, to)
      const m = b.model
      return withFigures(b, [
        { label: `Gross ${ctx.profile.accountingBasis === 'cash' ? 'receipts (collected)' : 'sales (accrued)'}`, value: peso(m.grossReceipts) },
        { label: 'Rate', value: `${m.taxRatePercent}%` },
        { label: 'Percentage tax due', value: peso(m.percentageTaxDue) },
        { label: 'Less: creditable percentage tax withheld', value: peso(m.creditableTaxWithheld) },
        { label: 'Total payable', value: peso(m.totalPayable), strong: true },
      ])
    }
    case formCode === '0619-E' || formCode === '0619-F': {
      const b = buildReturn0619(ctx, p.year, p.month, formCode.endsWith('E') ? 'E' : 'F')
      return withFigures(b, [
        { label: `Total ${formCode.endsWith('E') ? 'expanded' : 'final'} tax withheld for ${to.slice(0, 7)}`, value: peso(b.model.taxWithheld), strong: true },
      ])
    }
    case formCode === '1601-EQ' || formCode === '1601-FQ': {
      const variant = formCode === '1601-EQ' ? 'EQ' : 'FQ'
      const b = buildReturn1601Q(ctx, from, to, variant)
      const m = b.model
      return withFigures(
        b,
        [
          ...m.rows.map((r) => ({
            label: `${r.atc} — ${r.natureOfPayment} (base ${r.taxBase.format()})`,
            value: peso(r.taxWithheld),
          })),
          { label: 'Total tax withheld for the quarter', value: peso(m.totalTaxWithheld), strong: true },
          { label: 'Less: remitted with 0619s (months 1-2)', value: peso(m.monthlyRemittances) },
          { label: 'Net remittance with this return', value: peso(m.netRemittance), strong: true },
        ],
        [
          {
            label: `QAP (Quarterly Alphalist of Payees, ${variant})`,
            csv: () => qapDraftCsv(buildQap(ctx, from, to, variant)),
            datKind: 'QAP',
          },
        ],
      )
    }
    case formCode === '1601-C': {
      const b = buildReturn1601C(ctx, from, to)
      const m = b.model
      return withFigures(b, [
        { label: 'Total compensation', value: peso(m.totalCompensation) },
        { label: 'Non-taxable compensation (contributions, de minimis, exempt 13th month)', value: peso(m.nonTaxableCompensation) },
        { label: 'Taxable compensation', value: peso(m.taxableCompensation) },
        { label: 'Tax withheld', value: peso(m.taxWithheld) },
        { label: 'Total remittance', value: peso(m.totalRemittance), strong: true },
      ])
    }
    case formCode === '1701Q': {
      const b = buildReturn1701Q(ctx, `${year}-01-01`, to)
      const m = b.model
      return withFigures(
        b,
        [
          { label: `Method`, value: m.method === 'eight_percent' ? '8% of gross' : 'Graduated' },
          { label: 'Gross sales/receipts (YTD)', value: peso(m.grossReceipts) },
          { label: 'Deductions (YTD)', value: peso(m.deductions) },
          { label: 'Taxable income to date', value: peso(m.taxableIncomeToDate) },
          { label: 'Tax due to date', value: peso(m.taxDueToDate) },
          { label: 'Less: prior quarters’ payments', value: peso(m.priorQuartersPayments) },
          { label: 'Less: creditable withholding (2307s, YTD)', value: peso(m.creditableWithheld) },
          { label: 'Net payable', value: peso(m.netPayable), strong: true },
        ],
        [
          {
            label: 'SAWT (creditable withholding claimed)',
            csv: () => sawtDraftCsv(buildSawt(ctx, `${year}-01-01`, to, '1701Q')),
            datKind: 'SAWT',
          },
        ],
      )
    }
    case formCode === '1701' || formCode === '1701A': {
      const b = buildReturn1701(ctx, year)
      const m = b.model
      return withFigures(
        b,
        [
          { label: 'Variant', value: m.variant },
          { label: 'Method', value: m.method === 'eight_percent' ? '8% of gross' : 'Graduated' },
          { label: 'Gross sales/receipts', value: peso(m.grossReceipts) },
          { label: 'Cost of sales', value: peso(m.costOfSales) },
          { label: 'Deductions', value: peso(m.deductions) },
          { label: 'Taxable income', value: peso(m.taxableIncome) },
          { label: 'Income tax due', value: peso(m.taxDue) },
          { label: 'Less: credits and payments', value: peso(m.creditsAndPayments) },
          { label: 'Net payable', value: peso(m.netPayable), strong: true },
        ],
        [
          {
            label: 'SAWT',
            csv: () => sawtDraftCsv(buildSawt(ctx, `${year}-01-01`, to, m.variant)),
            datKind: 'SAWT',
          },
        ],
      )
    }
    case formCode === '1702Q': {
      // 1702Q is CUMULATIVE: figures run from the fiscal year start, whatever
      // quarter window the user picked.
      const fqq = fiscalQuarterOf(to, ctx.profile.fiscalYearEndMonth)
      const fiscalYearStart = addMonthsIso(fqq.startDate, -3 * (fqq.quarter - 1))
      const b = buildReturn1702Q(ctx, fiscalYearStart, to, { totalAssetsExclLandCentavos: overrides.totalAssetsExclLandCentavos })
      const m = b.model
      return withFigures(
        b,
        [
          { label: 'Gross income (YTD)', value: peso(m.grossIncome) },
          { label: 'Deductions (YTD)', value: peso(m.deductions) },
          { label: 'Taxable income to date', value: peso(m.taxableIncomeToDate) },
          { label: 'RCIT', value: peso(m.rcit) },
          { label: 'MCIT (2% of gross income)', value: peso(m.mcit) },
          { label: 'Tax due (higher of RCIT/MCIT)', value: peso(m.taxDueToDate) },
          { label: 'Less: prior quarters’ payments', value: peso(m.priorQuartersPayments) },
          { label: 'Less: creditable withholding (2307s, YTD)', value: peso(m.creditableWithheld) },
          { label: 'Net payable', value: peso(m.netPayable), strong: true },
        ],
        [
          {
            label: 'SAWT',
            csv: () => sawtDraftCsv(buildSawt(ctx, from, to, '1702Q')),
            datKind: 'SAWT',
          },
        ],
      )
    }
    case formCode.startsWith('1702-'): {
      const fq2 = fiscalQuarterOf(to, ctx.profile.fiscalYearEndMonth)
      const fyStart = addMonthsIso(fq2.startDate, -3 * (fq2.quarter - 1))
      const b = buildReturn1702(ctx, fyStart, to, { totalAssetsExclLandCentavos: overrides.totalAssetsExclLandCentavos })
      const m = b.model
      return withFigures(b, [
        { label: 'Variant', value: `1702-${m.variant}` },
        { label: 'Gross income', value: peso(m.grossIncome) },
        { label: 'Deductions', value: peso(m.deductions) },
        { label: 'Taxable income', value: peso(m.taxableIncome) },
        { label: 'RCIT', value: peso(m.rcit) },
        { label: 'MCIT', value: peso(m.mcit) },
        { label: 'Tax due', value: peso(m.taxDue) },
        { label: 'Less: credits and payments', value: peso(m.creditsAndPayments) },
        { label: 'Net payable', value: peso(m.netPayable), strong: true },
      ])
    }
    case formCode === '1604-C' || formCode === '1604-E' || formCode === '1604-F': {
      const variant = formCode.slice(-1) as 'C' | 'E' | 'F'
      const b = buildReturn1604(ctx, year, variant)
      const m = b.model
      return withFigures(
        b,
        [
          ...m.rows.slice(0, 25).map((r) => ({
            label: `${r.seq}. ${r.name} (${formatTIN(r.tin)}) — ${r.atc}`,
            value: peso(r.taxWithheld),
          })),
          ...(m.rows.length > 25 ? [{ label: `… ${m.rows.length - 25} more rows in the alphalist`, value: '' }] : []),
          { label: 'Total tax base', value: peso(m.totalBase) },
          { label: 'Total tax withheld', value: peso(m.totalWithheld), strong: true },
        ],
        [
          {
            label: `Annual alphalist (${variant})`,
            csv: () => alphalistDraftCsv(buildAnnualAlphalist(ctx, year, variant)),
            datKind: `ALPHALIST_1604${variant}`,
          },
        ],
      )
    }
    default: {
      return {
        rows: [
          {
            label: `${formCode}`,
            value: 'This form has no computed line mapping yet — figures come from the ledger views.',
          },
        ],
        figures: {},
        model: null,
        attachments: noAttachments,
      }
    }
  }
}

// ---------------- Certificates ----------------

function CertificatesTab({ ctx }: { ctx: ReturnContext }) {
  const [quarterStartMonth, setQuarterStartMonth] = useState(`${thisYear}-01`)
  const [certYear, setCertYear] = useState(thisYear)
  const [print2307, setPrint2307] = useState<Form2307 | null>(null)
  const [print2316, setPrint2316] = useState<Form2316 | null>(null)

  const quarterStart = {
    year: Number(quarterStartMonth.slice(0, 4)),
    month: Number(quarterStartMonth.slice(5, 7)),
  }
  const certs2307 = useMemo(() => build2307Certificates(ctx, quarterStart), [ctx, quarterStartMonth])
  const certs2306 = useMemo(() => build2306Certificates(ctx, quarterStart), [ctx, quarterStartMonth])
  const certs2316 = useMemo(() => build2316Certificates(ctx, certYear), [ctx, certYear])

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">2307 — creditable withholding, per payee per quarter</h2>
          <label className="flex items-center gap-2 text-sm">
            Quarter starting
            <input type="month" value={quarterStartMonth} onChange={(e) => setQuarterStartMonth(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
        </div>
        {certs2307.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">No expanded withholding in this quarter.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {certs2307.map((c) => (
              <li key={c.payee.registeredName} className="flex items-center justify-between py-2">
                <span>
                  {c.payee.registeredName} <span className="text-xs text-slate-400">{formatTIN(c.payee.tin)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{peso(c.totalWithheld)}</span>
                  <button onClick={() => setPrint2307(c)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">
                    Print view
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {certs2306.length > 0 && (
          <>
            <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-600">2306 — final withholding</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {certs2306.map((c, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span>{c.payee.registeredName} · {c.atc}</span>
                  <span className="tabular-nums">{peso(c.finalTaxWithheld)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">2316 — per employee, annual</h2>
          <label className="flex items-center gap-2 text-sm">
            Year
            <input type="number" value={certYear} onChange={(e) => setCertYear(Number(e.target.value))} className="w-24 rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
        </div>
        {certs2316.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">No payroll posted in this year.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {certs2316.map((c) => (
              <li key={c.employee.employeeNo + c.employee.registeredName} className="flex items-center justify-between py-2">
                <span>{c.employee.registeredName}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">tax due {peso(c.taxDue)} · withheld {peso(c.taxWithheld)}</span>
                  <button onClick={() => setPrint2316(c)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">
                    Print view
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {print2307 && <CertificatePrint onClose={() => setPrint2307(null)} cert={{ kind: '2307', data: print2307 }} />}
      {print2316 && <CertificatePrint onClose={() => setPrint2316(null)} cert={{ kind: '2316', data: print2316 }} />}
    </div>
  )
}

function CertificatePrint({
  cert,
  onClose,
}: {
  cert: { kind: '2307'; data: Form2307 } | { kind: '2316'; data: Form2316 }
  onClose(): void
}) {
  document.body.classList.add('printing')
  const cleanup = () => {
    document.body.classList.remove('printing')
    onClose()
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-700/60">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900 px-4 py-2 text-white print:hidden">
        <span className="text-sm font-medium">BIR Form {cert.kind} — print preview</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium hover:bg-brand-500">Print…</button>
          <button onClick={cleanup} className="rounded-lg border border-slate-500 px-4 py-1.5 text-sm hover:bg-slate-800">Close</button>
        </div>
      </div>
      <div className="print-area mx-auto my-6 max-w-2xl bg-white p-10 shadow-lg print:my-0 print:max-w-none print:shadow-none">
        {cert.kind === '2307' ? <Body2307 c={cert.data} /> : <Body2316 c={cert.data} />}
      </div>
    </div>
  )
}

function Body2307({ c }: { c: Form2307 }) {
  return (
    <div className="text-sm">
      <h1 className="text-center text-base font-bold">Certificate of Creditable Tax Withheld at Source</h1>
      <p className="text-center text-xs">BIR Form No. 2307 · {c.periodFrom} to {c.periodTo}</p>
      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        <div className="rounded border border-slate-400 p-2">
          <p className="font-semibold uppercase text-slate-500">Payee</p>
          <p className="font-medium">{c.payee.registeredName}</p>
          <p>TIN {formatTIN(c.payee.tin)}</p>
          <p>{c.payee.address}</p>
        </div>
        <div className="rounded border border-slate-400 p-2">
          <p className="font-semibold uppercase text-slate-500">Payor (withholding agent)</p>
          <p className="font-medium">{c.payor.registeredName}</p>
          <p>TIN {formatTIN(c.payor.tin)}</p>
          <p>{c.payor.address}</p>
        </div>
      </div>
      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr>
            {['Income payments', 'ATC', '1st month', '2nd month', '3rd month', 'Total', 'Tax withheld'].map((h) => (
              <th key={h} className="border border-slate-400 px-1.5 py-1 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <tr key={r.atc}>
              <td className="border border-slate-400 px-1.5 py-1">{r.natureOfPayment}</td>
              <td className="border border-slate-400 px-1.5 py-1">{r.atc}</td>
              {r.monthAmounts.map((m, i) => (
                <td key={i} className="border border-slate-400 px-1.5 py-1 text-right tabular-nums">{m.format()}</td>
              ))}
              <td className="border border-slate-400 px-1.5 py-1 text-right tabular-nums">{r.total.format()}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right tabular-nums">{r.taxWithheld.format()}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={5} className="border border-slate-400 px-1.5 py-1">TOTAL</td>
            <td className="border border-slate-400 px-1.5 py-1 text-right tabular-nums">{c.totalBase.format()}</td>
            <td className="border border-slate-400 px-1.5 py-1 text-right tabular-nums">{c.totalWithheld.format()}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t border-slate-500 pt-1 text-center">Payor / Authorized Representative</div>
        <div className="border-t border-slate-500 pt-1 text-center">Payee / Authorized Representative</div>
      </div>
    </div>
  )
}

function Body2316({ c }: { c: Form2316 }) {
  const row = (label: string, value: string) => (
    <div className="flex justify-between border-b border-slate-200 py-1">
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
  return (
    <div className="text-sm">
      <h1 className="text-center text-base font-bold">Certificate of Compensation Payment / Tax Withheld</h1>
      <p className="text-center text-xs">BIR Form No. 2316 · Calendar year {c.year}</p>
      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        <div className="rounded border border-slate-400 p-2">
          <p className="font-semibold uppercase text-slate-500">Employee</p>
          <p className="font-medium">{c.employee.registeredName}</p>
          <p>TIN {formatTIN(c.employee.tin)}</p>
          <p>Employee № {c.employee.employeeNo}</p>
        </div>
        <div className="rounded border border-slate-400 p-2">
          <p className="font-semibold uppercase text-slate-500">Employer</p>
          <p className="font-medium">{c.employer.registeredName}</p>
          <p>TIN {formatTIN(c.employer.tin)}</p>
          <p>{c.employer.address}</p>
        </div>
      </div>
      <div className="mt-4 text-xs">
        {row('Compensation period', `${c.compensationFrom} → ${c.compensationTo}`)}
        {row('Gross compensation', c.grossCompensation.format())}
        {row('Non-taxable (contributions, de minimis, exempt 13th month)', c.nonTaxableDeMinimis.format())}
        {row('Taxable compensation', c.taxableCompensation.format())}
        {row('Tax due (annualized)', c.taxDue.format())}
        {row('Tax withheld', c.taxWithheld.format())}
        {row('Substituted filing', c.substitutedFiling ? 'Yes — withheld equals due' : 'No')}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t border-slate-500 pt-1 text-center">Employer / Authorized Agent</div>
        <div className="border-t border-slate-500 pt-1 text-center">Employee</div>
      </div>
    </div>
  )
}
