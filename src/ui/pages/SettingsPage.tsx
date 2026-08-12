import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { dataPort } from '../../data'
import { exportCompany, importCompany, parseCompanyBundle } from '../../data/portability'
import { instantiateTemplate } from '../../domain/coa'
import { formatTIN } from '../../domain/core'
import {
  applyProfileRevision,
  registrationSummary,
  resolveProfile,
  type QuestionnaireAnswers,
} from '../../domain/profileResolution'
import type { TaxProfile } from '../../domain/taxProfile'
import { coaTemplateForProfile } from '../../seed/coaTemplates'
import { defaultAnswers, ProfileQuestionnaire } from '../onboarding/ProfileQuestionnaire'
import {
  setSelectedCompany,
  useCompanyData,
  useInvalidateCompany,
  useSelectedCompanyId,
} from '../state/company'

/**
 * Registration settings: shows the profile versions timeline and lets the
 * user re-run the questionnaire with a dated effectivity. The open version
 * closes the day before the new one starts, so history never rewrites; new
 * registrations (e.g. becoming VAT) can pull their missing COA accounts in.
 */

const answersFromProfile = (p: TaxProfile, effectiveFrom: string): QuestionnaireAnswers => ({
  ...defaultAnswers(effectiveFrom),
  entityType: p.entityType,
  incomeTaxRegime: p.incomeTaxRegime,
  businessTaxRegime: p.businessTaxRegime,
  hasEmployees: p.withholdingAgent.compensation,
  withholdsExpanded: p.withholdingAgent.expanded,
  withholdsFinal: p.withholdingAgent.final,
  isTopWithholdingAgent: p.withholdingAgent.topWithholdingAgent,
  isGovernmentPayor: p.withholdingAgent.governmentPayor,
  otherLiabilities: p.otherLiabilities,
  accountingBasis: p.accountingBasis,
  fiscalYearEndMonth: p.fiscalYearEndMonth,
  hasMixedTransactions: p.hasMixedTransactions,
  startOfOperations: p.startOfOperations,
  rdoCode: p.rdoCode,
  ...(p.incentive ? { incentive: p.incentive } : {}),
})

export function SettingsPage() {
  const companyId = useSelectedCompanyId()
  const { accounts, profile } = useCompanyData(companyId)
  const invalidate = useInvalidateCompany()
  const [editing, setEditing] = useState<QuestionnaireAnswers | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const companyQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => dataPort().companies.get(companyId!),
    enabled: companyId !== null,
  })
  const versionsQ = useQuery({
    queryKey: ['profile-versions', companyId],
    queryFn: () => dataPort().taxProfiles.listVersions(companyId!),
    enabled: companyId !== null,
  })

  const preview = useMemo(() => {
    if (!editing) return null
    try {
      return resolveProfile(editing)
    } catch {
      return null
    }
  }, [editing])

  if (!companyId) return <p className="text-slate-500">Select a company.</p>
  const company = companyQ.data

  const startEditing = () => {
    const current = profile.data
    const today = new Date().toISOString().slice(0, 10)
    setEditing(current ? answersFromProfile(current, today) : defaultAnswers(today))
    setMessage(null)
  }

  const saveRevision = async () => {
    if (!preview) {
      setMessage({ kind: 'error', text: 'The questionnaire is incomplete.' })
      return
    }
    try {
      const port = dataPort()
      const versions = await port.taxProfiles.listVersions(companyId)
      const { toSave } = applyProfileRevision(versions, preview)
      for (const v of toSave) await port.taxProfiles.save(companyId, v)

      // Pull in template accounts the new registration needs but the COA lacks.
      const existing = await port.accounts.list(companyId)
      const have = new Set(existing.map((a) => a.code))
      const missing = coaTemplateForProfile(preview).filter((r) => !have.has(r.code))
      if (missing.length) {
        await port.accounts.saveMany(instantiateTemplate(companyId, missing))
      }

      invalidate(companyId)
      setEditing(null)
      setMessage({
        kind: 'ok',
        text: `Registration updated effective ${preview.effectiveFrom}${missing.length ? `; ${missing.length} account(s) added to the chart` : ''}.`,
      })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-bold">Registration &amp; settings</h1>
        <p className="text-sm text-slate-500">
          The tax profile drives every computation, sheet, and deadline. Changes take a dated
          effectivity — prior periods keep computing under the profile in force at the time.
        </p>
      </header>

      {company && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <h2 className="mb-2 font-semibold">{company.registeredName}</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">TIN</dt><dd>{formatTIN(company.tin)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Business style</dt><dd>{company.businessStyle || '—'}</dd></div>
            <div className="col-span-2 flex justify-between"><dt className="text-slate-500">Registered address</dt><dd>{company.registeredAddress}</dd></div>
          </dl>
        </section>
      )}

      {message && (
        <p className={`rounded-lg p-3 text-sm ${message.kind === 'ok' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </p>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Profile versions</h2>
          {!editing && (
            <button
              onClick={startEditing}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Re-run questionnaire…
            </button>
          )}
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {(versionsQ.data ?? []).map((v) => (
            <li key={v.effectiveFrom} className="flex items-center gap-3 py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.effectiveTo === null ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                {v.effectiveTo === null ? 'current' : 'superseded'}
              </span>
              <span className="font-medium">{v.effectiveFrom} → {v.effectiveTo ?? 'open'}</span>
              <span className="text-slate-500">
                {v.entityType.replace(/_/g, ' ')} · {v.incomeTaxRegime.replace(/_/g, ' ')} ·{' '}
                {v.businessTaxRegime.replace(/_/g, ' ')}
              </span>
            </li>
          ))}
          {(versionsQ.data ?? []).length === 0 && (
            <li className="py-3 text-slate-400">No profile yet — run the questionnaire.</li>
          )}
        </ul>
      </section>

      <PortabilitySection companyId={companyId} companyName={company?.registeredName ?? ''} />

      {editing && (
        <section className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100" data-editing>
          <h2 className="font-semibold">Update registration</h2>
          <ProfileQuestionnaire value={editing} onChange={setEditing} showEffectiveFrom />
          {preview && (
            <div className="rounded-lg bg-slate-50 p-3">
              <h3 className="mb-1 text-sm font-semibold text-slate-600">Will register for</h3>
              <div className="flex flex-wrap gap-1.5">
                {registrationSummary(preview).registeredTaxTypes.map((t) => (
                  <span key={t} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    {t.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveRevision()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Save with effectivity
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function PortabilitySection({ companyId, companyName }: { companyId: string; companyName: string }) {
  const invalidate = useInvalidateCompany()
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const doExport = async () => {
    try {
      const bundle = await exportCompany(dataPort(), companyId)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${companyName.replace(/[^\w-]+/g, '-') || 'company'}-${new Date().toISOString().slice(0, 10)}.phbooks.json`
      a.click()
      URL.revokeObjectURL(a.href)
      setNote({ kind: 'ok', text: 'Exported the full company as JSON.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const doImport = async (file: File) => {
    try {
      const bundle = parseCompanyBundle(await file.text())
      const company = await importCompany(dataPort(), bundle)
      invalidate(company.id)
      setSelectedCompany(company.id)
      setNote({ kind: 'ok', text: `Imported ${company.registeredName} — switched to it.` })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <h2 className="mb-1 font-semibold">Portability</h2>
      <p className="mb-3 text-sm text-slate-500">
        Move a whole company between browsers before any backend exists: the export carries the
        profile history, chart, master data, sheets, the append-only ledger, locks, generated
        returns, and the audit trail.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void doExport()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Export this company (JSON)
        </button>
        <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
          Import a company…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void doImport(f)
            e.target.value = ''
          }}
        />
      </div>
      {note && (
        <p className={`mt-2 text-sm ${note.kind === 'ok' ? 'text-brand-700' : 'text-red-600'}`}>{note.text}</p>
      )}
    </section>
  )
}
