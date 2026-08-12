import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { dataPort, type Company } from '../../data'
import { instantiateTemplate } from '../../domain/coa'
import { tin } from '../../domain/core'
import { RDO_SEED } from '../../domain/masterData'
import {
  registrationSummary,
  resolveProfile,
  type QuestionnaireAnswers,
} from '../../domain/profileResolution'
import { coaTemplateForProfile } from '../../seed/coaTemplates'
import { setSelectedCompany, useInvalidateCompany } from '../state/company'
import { CoaEditor, toEditableRows, type EditableCoaRow } from './CoaEditor'
import { defaultAnswers, Field, ProfileQuestionnaire } from './ProfileQuestionnaire'

/**
 * Onboarding: company → questionnaire → derived registration review → chart
 * of accounts → create. The questionnaire only offers reachable choices; the
 * review step shows exactly what registration was derived BEFORE anything is
 * written; the COA starts from a profile-driven template the user can edit.
 */

const companySchema = z.object({
  registeredName: z.string().min(2, 'Registered name is required'),
  businessStyle: z.string(),
  tinBase: z.string().regex(/^\d{9}$/, 'TIN is 9 digits (no branch code here)'),
  tinBranch: z.string().regex(/^\d{3}(\d{2})?$/, 'Branch code is 3 or 5 digits'),
  registeredAddress: z.string().min(4, 'Registered address is required'),
  zipCode: z.string(),
  rdoCode: z.string().min(2, 'Pick your RDO'),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Registration date is required'),
})
type CompanyForm = z.infer<typeof companySchema>

const STEPS = ['Company', 'Tax profile', 'Review registration', 'Chart of accounts'] as const

export function OnboardingWizard() {
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<CompanyForm | null>(null)
  const [answers, setAnswers] = useState<QuestionnaireAnswers | null>(null)
  const [coaRows, setCoaRows] = useState<EditableCoaRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const invalidate = useInvalidateCompany()

  const profile = useMemo(() => {
    if (!answers) return null
    try {
      return resolveProfile(answers)
    } catch {
      return null
    }
  }, [answers])

  const goToReview = () => {
    if (!profile) {
      setError('The questionnaire is incomplete.')
      return
    }
    setError(null)
    setStep(2)
  }

  const goToCoa = () => {
    if (!profile) return
    // (Re)build the template only when none exists yet or profile changed shape.
    setCoaRows((rows) => rows ?? toEditableRows(coaTemplateForProfile(profile)))
    setStep(3)
  }

  const finish = async () => {
    if (!company || !profile || !coaRows) return
    try {
      const companyId = `co-${company.tinBase}-${company.tinBranch}`
      const port = dataPort()
      if (await port.companies.get(companyId)) {
        setError(`A company with TIN ${company.tinBase}-${company.tinBranch} already exists here.`)
        return
      }
      const record: Company = {
        id: companyId,
        tin: tin(company.tinBase, company.tinBranch),
        registeredName: company.registeredName,
        businessStyle: company.businessStyle,
        registeredAddress: company.registeredAddress,
        zipCode: company.zipCode || undefined,
        createdAt: new Date().toISOString(),
      }
      await port.companies.save(record)
      await port.taxProfiles.save(companyId, profile)
      const activeByCode = new Map(coaRows.map((r) => [r.code, r.active]))
      const accounts = instantiateTemplate(
        companyId,
        coaRows.map(({ active: _active, ...row }) => row),
      ).map((a) => ({ ...a, active: activeByCode.get(a.code) ?? true }))
      await port.accounts.saveMany(accounts)
      setSelectedCompany(companyId)
      invalidate(companyId)
      void navigate({ to: '/app' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <ol className="mb-8 flex gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`flex-1 rounded-full px-3 py-1.5 text-center font-medium ${
                i === step
                  ? 'bg-brand-600 text-white'
                  : i < step
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-200 text-slate-500'
              }`}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {step === 0 && (
          <StepCompany
            initial={company}
            onNext={(v) => {
              setCompany(v)
              setAnswers(
                (a) =>
                  a ?? { ...defaultAnswers(v.registrationDate), rdoCode: v.rdoCode },
              )
              setStep(1)
            }}
          />
        )}

        {step === 1 && answers && (
          <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold">Tax profile questionnaire</h1>
            <p className="text-sm text-slate-500">
              Answer from your BIR Certificate of Registration (Form 2303). Every option below is
              derived from your previous answers — combinations the BIR would reject are simply not
              offered.
            </p>
            <ProfileQuestionnaire value={answers} onChange={setAnswers} />
            <WizardNav onBack={() => setStep(0)} onNext={goToReview} />
          </div>
        )}

        {step === 2 && profile && (
          <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold">Derived registration</h1>
            <p className="text-sm text-slate-500">
              This is the registration the questionnaire resolved. Confirm it matches your Form 2303
              before continuing — everything in the app derives from it.
            </p>
            <RegistrationReview profileSummary={registrationSummary(profile)} effectiveFrom={profile.effectiveFrom} />
            <WizardNav onBack={() => setStep(1)} onNext={goToCoa} nextLabel="Looks right — continue" />
          </div>
        )}

        {step === 3 && coaRows && (
          <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold">Chart of accounts</h1>
            <p className="text-sm text-slate-500">
              Built for this profile — {coaRows.length} accounts.{' '}
              {profile?.registeredTaxTypes.has('vat')
                ? 'VAT accounts are included because you are VAT-registered.'
                : 'No VAT accounts appear because you are not VAT-registered.'}{' '}
              Rename, add, deactivate, or re-map tags before going live; reports follow the tags,
              not the codes.
            </p>
            <CoaEditor rows={coaRows} onChange={setCoaRows} />
            <p className="text-xs text-slate-500">
              Customers, suppliers, employees, and items are imported afterwards under{' '}
              <span className="font-medium">Master data</span> — including paste-from-Excel bulk
              import.
            </p>
            <WizardNav onBack={() => setStep(2)} onNext={() => void finish()} nextLabel="Create company" />
          </div>
        )}
      </div>
    </div>
  )
}

function RegistrationReview({
  profileSummary,
  effectiveFrom,
}: {
  profileSummary: ReturnType<typeof registrationSummary>
  effectiveFrom: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-slate-600">Registered tax types</h2>
        <div className="flex flex-wrap gap-1.5">
          {profileSummary.registeredTaxTypes.map((t) => (
            <span key={t} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              {t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-1 text-sm font-semibold text-slate-600">
          Returns this registration will file
        </h2>
        <ul className="grid grid-cols-2 gap-x-4 text-sm">
          {profileSummary.forms.map((f) => (
            <li key={f.formCode} className="py-0.5">
              <span className="font-semibold">{f.formCode}</span>{' '}
              <span className="text-slate-500">{f.title}</span>
            </li>
          ))}
        </ul>
      </div>
      {profileSummary.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          {profileSummary.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Effective from <span className="font-medium">{effectiveFrom}</span>. You can re-run this
        questionnaire later with a new effectivity date (e.g. a mid-year VAT registration) without
        rewriting history.
      </p>
    </div>
  )
}

function StepCompany({ initial, onNext }: { initial: CompanyForm | null; onNext(v: CompanyForm): void }) {
  const { register, handleSubmit, formState } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues:
      initial ?? {
        tinBranch: '000',
        businessStyle: '',
        registeredName: '',
        tinBase: '',
        registeredAddress: '',
        zipCode: '',
        rdoCode: '',
        registrationDate: new Date().toISOString().slice(0, 10),
      },
  })
  const err = formState.errors
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold">Company registration details</h1>
      <Field label="Registered name (per BIR Form 2303)" hint={err.registeredName?.message}>
        <input {...register('registeredName')} className="input" />
      </Field>
      <Field label="Business style / trade name" hint={err.businessStyle?.message}>
        <input {...register('businessStyle')} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="TIN (9 digits)" hint={err.tinBase?.message}>
          <input {...register('tinBase')} placeholder="123456789" className="input" />
        </Field>
        <Field label="Branch code" hint={err.tinBranch?.message}>
          <input {...register('tinBranch')} placeholder="000" className="input" />
        </Field>
      </div>
      <Field label="Registered address" hint={err.registeredAddress?.message}>
        <input {...register('registeredAddress')} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="ZIP code" hint={err.zipCode?.message}>
          <input {...register('zipCode')} className="input" />
        </Field>
        <Field label="BIR registration date" hint={err.registrationDate?.message}>
          <input type="date" {...register('registrationDate')} className="input" />
        </Field>
      </div>
      <Field label="Revenue District Office" hint={err.rdoCode?.message}>
        <select {...register('rdoCode')} className="input">
          <option value="">Choose RDO…</option>
          {RDO_SEED.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} — {r.name}
            </option>
          ))}
        </select>
      </Field>
      <WizardNav onNext="submit" />
    </form>
  )
}

function WizardNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack?(): void
  onNext: 'submit' | (() => void)
  nextLabel?: string
}) {
  return (
    <div className="flex justify-between pt-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        type={onNext === 'submit' ? 'submit' : 'button'}
        onClick={onNext === 'submit' ? undefined : onNext}
        className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {nextLabel ?? 'Continue'}
      </button>
    </div>
  )
}
