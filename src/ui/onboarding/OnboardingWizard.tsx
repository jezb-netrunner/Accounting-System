import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { dataPort, type Company } from '../../data'
import { instantiateTemplate } from '../../domain/coa'
import { tin } from '../../domain/core'
import { RDO_SEED } from '../../domain/masterData'
import {
  validateTaxProfile,
  type EntityType,
  type RegisteredTaxType,
  type TaxProfile,
} from '../../domain/taxProfile'
import { STANDARD_PH_COA } from '../../seed/coaTemplates'
import { setSelectedCompany, useInvalidateCompany } from '../state/company'

/**
 * Four-step onboarding: company → tax profile questionnaire → chart of
 * accounts template → master data import. The questionnaire is the moment
 * the TaxProfile is resolved; everything downstream derives from it.
 */

const companySchema = z.object({
  registeredName: z.string().min(2, 'Registered name is required'),
  businessStyle: z.string(),
  tinBase: z.string().regex(/^\d{9}$/, 'TIN is 9 digits (no branch code here)'),
  tinBranch: z.string().regex(/^\d{3}(\d{2})?$/, 'Branch code is 3 or 5 digits'),
  registeredAddress: z.string().min(4, 'Registered address is required'),
  rdoCode: z.string().min(2, 'Pick your RDO'),
})
type CompanyForm = z.infer<typeof companySchema>

const profileSchema = z.object({
  entityType: z.string(),
  incomeTaxRegime: z.string(),
  businessTaxRegime: z.string(),
  accountingBasis: z.enum(['accrual', 'cash']),
  fiscalYearEndMonth: z.coerce.number().min(1).max(12),
  hasMixedTransactions: z.boolean(),
  waExpanded: z.boolean(),
  waFinal: z.boolean(),
  waCompensation: z.boolean(),
  waTopAgent: z.boolean(),
  liabDst: z.boolean(),
  liabExcise: z.boolean(),
  liabFbt: z.boolean(),
})
type ProfileForm = z.infer<typeof profileSchema>

const ENTITY_OPTIONS: { value: EntityType; label: string }[] = [
  { value: 'sole_proprietor', label: 'Sole proprietor' },
  { value: 'self_employed_professional', label: 'Self-employed professional' },
  { value: 'mixed_income_individual', label: 'Mixed-income individual (employed + business)' },
  { value: 'estate', label: 'Estate' },
  { value: 'trust', label: 'Trust' },
  { value: 'general_professional_partnership', label: 'General professional partnership (GPP)' },
  { value: 'partnership', label: 'Partnership (non-GPP)' },
  { value: 'domestic_corporation', label: 'Domestic corporation' },
  { value: 'one_person_corporation', label: 'One-person corporation (OPC)' },
  { value: 'resident_foreign_corporation', label: 'Resident foreign corporation' },
  { value: 'branch_office', label: 'Branch office' },
  { value: 'representative_office', label: 'Representative office' },
  { value: 'cooperative', label: 'Cooperative' },
  { value: 'non_stock_non_profit', label: 'Non-stock non-profit' },
]

export function OnboardingWizard() {
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<CompanyForm | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const invalidate = useInvalidateCompany()

  const finish = async () => {
    if (!company || !profileForm) return
    const companyId = `co-${company.tinBase}-${company.tinBranch}`
    const registeredTaxTypes = new Set<RegisteredTaxType>(['income_tax'])
    if (profileForm.businessTaxRegime === 'vat') registeredTaxTypes.add('vat')
    if (profileForm.businessTaxRegime === 'non_vat_percentage') registeredTaxTypes.add('percentage_tax')
    if (profileForm.waExpanded) registeredTaxTypes.add('withholding_expanded')
    if (profileForm.waFinal) registeredTaxTypes.add('withholding_final')
    if (profileForm.waCompensation) registeredTaxTypes.add('withholding_compensation')
    if (profileForm.liabDst) registeredTaxTypes.add('documentary_stamp_tax')
    if (profileForm.liabExcise) registeredTaxTypes.add('excise_tax')
    if (profileForm.liabFbt) registeredTaxTypes.add('fringe_benefits_tax')

    const profile: TaxProfile = {
      entityType: profileForm.entityType as TaxProfile['entityType'],
      incomeTaxRegime: profileForm.incomeTaxRegime as TaxProfile['incomeTaxRegime'],
      businessTaxRegime: profileForm.businessTaxRegime as TaxProfile['businessTaxRegime'],
      registeredTaxTypes,
      withholdingAgent: {
        expanded: profileForm.waExpanded,
        final: profileForm.waFinal,
        compensation: profileForm.waCompensation,
        governmentPayor: false,
        topWithholdingAgent: profileForm.waTopAgent,
      },
      otherLiabilities: {
        documentaryStampTax: profileForm.liabDst,
        exciseTax: profileForm.liabExcise,
        fringeBenefitsTax: profileForm.liabFbt,
      },
      accountingBasis: profileForm.accountingBasis,
      fiscalYearEndMonth: profileForm.fiscalYearEndMonth,
      hasMixedTransactions: profileForm.hasMixedTransactions,
      eoptClassification: 'micro',
      startOfOperations: null,
      rdoCode: company.rdoCode,
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
    }
    const problems = validateTaxProfile(profile)
    if (problems.length) {
      setError(problems.join('. '))
      setStep(1)
      return
    }

    const port = dataPort()
    const record: Company = {
      id: companyId,
      tin: tin(company.tinBase, company.tinBranch),
      registeredName: company.registeredName,
      businessStyle: company.businessStyle,
      registeredAddress: company.registeredAddress,
      createdAt: new Date().toISOString(),
    }
    await port.companies.save(record)
    await port.taxProfiles.save(companyId, profile)
    await port.accounts.saveMany(instantiateTemplate(companyId, STANDARD_PH_COA))
    setSelectedCompany(companyId)
    invalidate(companyId)
    void navigate({ to: '/app' })
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <ol className="mb-8 flex gap-2 text-xs">
          {['Company', 'Tax profile', 'Chart of accounts', 'Master data'].map((label, i) => (
            <li
              key={label}
              className={`flex-1 rounded-full px-3 py-1.5 text-center font-medium ${
                i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {step === 0 && <StepCompany initial={company} onNext={(v) => { setCompany(v); setStep(1) }} />}
        {step === 1 && (
          <StepProfile
            initial={profileForm}
            onBack={() => setStep(0)}
            onNext={(v) => { setProfileForm(v); setError(null); setStep(2) }}
          />
        )}
        {step === 2 && <StepCoa onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <StepImport onBack={() => setStep(2)} onFinish={() => void finish()} />}
      </div>
    </div>
  )
}

function StepCompany({ initial, onNext }: { initial: CompanyForm | null; onNext(v: CompanyForm): void }) {
  const { register, handleSubmit, formState } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: initial ?? { tinBranch: '000', businessStyle: '', registeredName: '', tinBase: '', registeredAddress: '', rdoCode: '' },
  })
  const err = formState.errors
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold">Company registration details</h1>
      <Field label="Registered name (per BIR Form 2303)" error={err.registeredName?.message}>
        <input {...register('registeredName')} className="input" />
      </Field>
      <Field label="Business style / trade name" error={err.businessStyle?.message}>
        <input {...register('businessStyle')} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="TIN (9 digits)" error={err.tinBase?.message}>
          <input {...register('tinBase')} placeholder="123456789" className="input" />
        </Field>
        <Field label="Branch code" error={err.tinBranch?.message}>
          <input {...register('tinBranch')} placeholder="000" className="input" />
        </Field>
      </div>
      <Field label="Registered address" error={err.registeredAddress?.message}>
        <input {...register('registeredAddress')} className="input" />
      </Field>
      <Field label="Revenue District Office" error={err.rdoCode?.message}>
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

function StepProfile({
  initial,
  onBack,
  onNext,
}: {
  initial: ProfileForm | null
  onBack(): void
  onNext(v: ProfileForm): void
}) {
  const { register, handleSubmit, watch } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues:
      initial ?? {
        entityType: 'sole_proprietor',
        incomeTaxRegime: 'graduated_itemized',
        businessTaxRegime: 'non_vat_percentage',
        accountingBasis: 'accrual',
        fiscalYearEndMonth: 12,
        hasMixedTransactions: false,
        waExpanded: false,
        waFinal: false,
        waCompensation: false,
        waTopAgent: false,
        liabDst: false,
        liabExcise: false,
        liabFbt: false,
      },
  })
  const entity = watch('entityType')
  const individual = ['sole_proprietor', 'self_employed_professional', 'mixed_income_individual', 'estate', 'trust'].includes(entity)

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold">Tax profile questionnaire</h1>
      <p className="text-sm text-slate-500">
        Answer from your BIR Certificate of Registration (Form 2303). This drives every
        computation, sheet, and deadline in the app.
      </p>
      <Field label="Entity type">
        <select {...register('entityType')} className="input">
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Income tax regime">
        <select {...register('incomeTaxRegime')} className="input">
          {individual ? (
            <>
              <option value="graduated_itemized">Graduated rates — itemized deductions</option>
              <option value="graduated_osd">Graduated rates — 40% OSD</option>
              <option value="eight_percent">8% of gross sales/receipts</option>
              <option value="exempt">Exempt</option>
            </>
          ) : (
            <>
              <option value="rcit">Regular corporate income tax (25% / 20%)</option>
              <option value="income_tax_holiday">Income tax holiday (incentive)</option>
              <option value="special_rate_incentive">5% special rate (incentive)</option>
              <option value="exempt">Exempt</option>
            </>
          )}
        </select>
      </Field>
      <Field label="Business tax">
        <select {...register('businessTaxRegime')} className="input">
          <option value="vat">VAT-registered (12%)</option>
          <option value="non_vat_percentage">Non-VAT — percentage tax</option>
          <option value="vat_exempt">VAT-exempt transactions only</option>
          <option value="vat_zero_rated">Zero-rated / effectively zero-rated</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Accounting basis">
          <select {...register('accountingBasis')} className="input">
            <option value="accrual">Accrual</option>
            <option value="cash">Cash</option>
          </select>
        </Field>
        <Field label="Fiscal year ends in">
          <select {...register('fiscalYearEndMonth')} className="input" disabled={individual}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleString('en', { month: 'long' })}
                {i + 1 === 12 ? ' (calendar year)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Withholding agent roles</legend>
        <Check label="Expanded / creditable withholding (0619-E, 1601-EQ)" {...register('waExpanded')} />
        <Check label="Final withholding (0619-F, 1601-FQ)" {...register('waFinal')} />
        <Check label="Compensation — we have employees (1601-C)" {...register('waCompensation')} />
        <Check label="Listed as a Top Withholding Agent" {...register('waTopAgent')} />
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Other liabilities</legend>
        <Check label="Documentary stamp tax (2000)" {...register('liabDst')} />
        <Check label="Excise tax" {...register('liabExcise')} />
        <Check label="Fringe benefits tax (1603Q)" {...register('liabFbt')} />
      </fieldset>
      <Check label="We have mixed transactions (VATable + exempt/zero-rated) needing input-VAT allocation" {...register('hasMixedTransactions')} />
      <WizardNav onBack={onBack} onNext="submit" />
    </form>
  )
}

function StepCoa({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  return (
    <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold">Chart of accounts</h1>
      <p className="text-sm text-slate-500">
        Start from the standard Philippine SME template — {STANDARD_PH_COA.length} accounts
        with BIR tax tags (output/input VAT, withholding payables, creditable
        certificates) already mapped. You can rename, add, or deactivate accounts later;
        reports follow the tags, not the codes.
      </p>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <tbody>
            {STANDARD_PH_COA.map((r) => (
              <tr key={r.code} className="border-t border-slate-100 first:border-0">
                <td className="w-20 px-3 py-1.5 font-mono text-xs">{r.code}</td>
                <td className={`px-3 py-1.5 ${r.postable === false ? 'font-semibold' : ''}`}>{r.name}</td>
                <td className="px-3 py-1.5 text-xs text-slate-400">{r.taxTag !== 'none' ? r.taxTag : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <WizardNav onBack={onBack} onNext={onNext} />
    </div>
  )
}

function StepImport({ onBack, onFinish }: { onBack(): void; onFinish(): void }) {
  return (
    <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold">Master data</h1>
      <p className="text-sm text-slate-500">
        Customers, suppliers, employees, bank accounts, and items can be imported from
        CSV — or pasted into the master-data screens later. Every party carries a TIN
        with branch code, registered name, address, and business style, because the
        SLSP, QAP, and alphalists will need them.
      </p>
      <label className="flex cursor-not-allowed items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-8 text-sm text-slate-400">
        CSV import lands with the master-data screens — skip for now
      </label>
      <WizardNav onBack={onBack} onNext={onFinish} nextLabel="Create company" />
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function Check({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" {...props} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
      {label}
    </label>
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
        <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
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
