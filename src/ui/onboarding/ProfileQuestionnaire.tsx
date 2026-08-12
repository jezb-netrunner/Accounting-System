import { useEffect } from 'react'
import {
  availableBusinessTaxRegimes,
  availableIncomeTaxRegimes,
  type QuestionnaireAnswers,
} from '../../domain/profileResolution'
import type { BusinessTaxRegime, EntityType, IncomeTaxRegime } from '../../domain/taxProfile'
import { isIndividualType } from '../../domain/taxProfile'
import { Money } from '../../lib/money'

/**
 * The tax-profile questionnaire, shared by onboarding and later re-runs.
 * Every option list is DERIVED from the answers so far, so invalid
 * combinations are unreachable rather than validated after the fact.
 */

export const ENTITY_OPTIONS: { value: EntityType; label: string }[] = [
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

const INCOME_REGIME_LABELS: Record<IncomeTaxRegime, string> = {
  graduated_itemized: 'Graduated rates — itemized deductions',
  graduated_osd: 'Graduated rates — 40% optional standard deduction',
  eight_percent: '8% of gross sales/receipts (in lieu of graduated + percentage tax)',
  rcit: 'Regular corporate income tax (25% / 20%)',
  income_tax_holiday: 'Income tax holiday (incentive)',
  special_rate_incentive: '5% special rate (SCIT/GIT incentive)',
  exempt: 'Exempt',
}

const BUSINESS_REGIME_LABELS: Record<BusinessTaxRegime, string> = {
  vat: 'VAT-registered (12%)',
  non_vat_percentage: 'Non-VAT — percentage tax (Sec. 116)',
  vat_exempt: 'VAT-exempt transactions only',
  vat_zero_rated: 'Zero-rated / effectively zero-rated',
}

export const defaultAnswers = (effectiveFrom: string): QuestionnaireAnswers => ({
  entityType: 'sole_proprietor',
  incomeTaxRegime: 'graduated_itemized',
  businessTaxRegime: 'non_vat_percentage',
  hasEmployees: false,
  withholdsExpanded: false,
  withholdsFinal: false,
  isTopWithholdingAgent: false,
  isGovernmentPayor: false,
  otherLiabilities: { documentaryStampTax: false, exciseTax: false, fringeBenefitsTax: false },
  accountingBasis: 'accrual',
  fiscalYearEndMonth: 12,
  hasMixedTransactions: false,
  expectedAnnualGrossCentavos: 0,
  startOfOperations: null,
  rdoCode: '',
  effectiveFrom,
})

interface Props {
  value: QuestionnaireAnswers
  onChange(next: QuestionnaireAnswers): void
  /** Onboarding hides it (uses registration date); re-runs show it. */
  showEffectiveFrom?: boolean
}

export function ProfileQuestionnaire({ value, onChange, showEffectiveFrom }: Props) {
  const incomeOptions = availableIncomeTaxRegimes(value.entityType)
  const businessOptions = availableBusinessTaxRegimes(value)
  const individual = isIndividualType(value.entityType)
  const needsIncentive =
    value.incomeTaxRegime === 'income_tax_holiday' ||
    value.incomeTaxRegime === 'special_rate_incentive'

  // Keep dependent answers reachable when an upstream answer changes.
  useEffect(() => {
    const patch: {
      -readonly [K in keyof QuestionnaireAnswers]?: QuestionnaireAnswers[K]
    } = {}
    if (!incomeOptions.includes(value.incomeTaxRegime)) patch.incomeTaxRegime = incomeOptions[0]
    if (!businessOptions.includes(value.businessTaxRegime)) {
      patch.businessTaxRegime = businessOptions[0]
    }
    if (individual && value.fiscalYearEndMonth !== 12) patch.fiscalYearEndMonth = 12
    if (needsIncentive && !value.incentive) {
      patch.incentive = { agency: 'PEZA', registrationNo: '', validFrom: value.effectiveFrom, validTo: null }
    }
    if (!needsIncentive && value.incentive) patch.incentive = undefined
    if (Object.keys(patch).length) onChange({ ...value, ...patch })
  }, [value, onChange, incomeOptions, businessOptions, individual, needsIncentive])

  const set = <K extends keyof QuestionnaireAnswers>(key: K, v: QuestionnaireAnswers[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="space-y-4">
      <Field label="Entity type">
        <select
          className="input"
          value={value.entityType}
          onChange={(e) => set('entityType', e.target.value as EntityType)}
        >
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Income tax regime" hint="Only regimes this entity type can register for are shown.">
        <select
          className="input"
          value={value.incomeTaxRegime}
          onChange={(e) => set('incomeTaxRegime', e.target.value as IncomeTaxRegime)}
        >
          {incomeOptions.map((r) => (
            <option key={r} value={r}>
              {INCOME_REGIME_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Business tax registration"
        hint={
          value.incomeTaxRegime === 'eight_percent'
            ? 'The 8% election is closed to VAT registrants, so VAT is not offered.'
            : undefined
        }
      >
        <select
          className="input"
          value={value.businessTaxRegime}
          onChange={(e) => set('businessTaxRegime', e.target.value as BusinessTaxRegime)}
        >
          {businessOptions.map((r) => (
            <option key={r} value={r}>
              {BUSINESS_REGIME_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>

      {needsIncentive && value.incentive && (
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3">
          <Field label="Incentive agency">
            <select
              className="input"
              value={value.incentive.agency}
              onChange={(e) =>
                set('incentive', { ...value.incentive!, agency: e.target.value as 'PEZA' | 'BOI' | 'other' })
              }
            >
              <option value="PEZA">PEZA</option>
              <option value="BOI">BOI</option>
              <option value="other">Other IPA</option>
            </select>
          </Field>
          <Field label="Registration number">
            <input
              className="input"
              value={value.incentive.registrationNo}
              onChange={(e) => set('incentive', { ...value.incentive!, registrationNo: e.target.value })}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Expected annual gross sales/receipts (₱)">
          <input
            className="input"
            inputMode="decimal"
            value={value.expectedAnnualGrossCentavos ? String(value.expectedAnnualGrossCentavos / 100) : ''}
            placeholder="e.g. 2500000"
            onChange={(e) => {
              try {
                set('expectedAnnualGrossCentavos', Money.parse(e.target.value || '0').centavos)
              } catch {
                /* keep last valid value while typing */
              }
            }}
          />
        </Field>
        <Field label="Start of operations">
          <input
            type="date"
            className="input"
            value={value.startOfOperations ?? ''}
            onChange={(e) => set('startOfOperations', e.target.value || null)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Accounting basis">
          <select
            className="input"
            value={value.accountingBasis}
            onChange={(e) => set('accountingBasis', e.target.value as 'accrual' | 'cash')}
          >
            <option value="accrual">Accrual</option>
            <option value="cash">Cash</option>
          </select>
        </Field>
        <Field
          label="Fiscal year ends in"
          hint={individual ? 'Individuals must use the calendar year.' : undefined}
        >
          <select
            className="input"
            value={value.fiscalYearEndMonth}
            disabled={individual}
            onChange={(e) => set('fiscalYearEndMonth', Number(e.target.value))}
          >
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
        <legend className="text-sm font-medium">Withholding roles</legend>
        <Check
          label="We have employees (withholding on compensation, 1601-C)"
          checked={value.hasEmployees}
          onChange={(v) => set('hasEmployees', v)}
        />
        <Check
          label="Expanded / creditable withholding agent (0619-E, 1601-EQ)"
          checked={value.withholdsExpanded || value.isTopWithholdingAgent}
          disabled={value.isTopWithholdingAgent}
          onChange={(v) => set('withholdsExpanded', v)}
        />
        <Check
          label="Final withholding agent (0619-F, 1601-FQ)"
          checked={value.withholdsFinal}
          onChange={(v) => set('withholdsFinal', v)}
        />
        <Check
          label="Published Top Withholding Agent (1% goods / 2% services on purchases)"
          checked={value.isTopWithholdingAgent}
          onChange={(v) => set('isTopWithholdingAgent', v)}
        />
        <Check
          label="Government entity / GOCC (withholds VAT on payments to suppliers)"
          checked={value.isGovernmentPayor}
          onChange={(v) => set('isGovernmentPayor', v)}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Other liabilities</legend>
        <Check
          label="Documentary stamp tax (2000)"
          checked={value.otherLiabilities.documentaryStampTax}
          onChange={(v) => set('otherLiabilities', { ...value.otherLiabilities, documentaryStampTax: v })}
        />
        <Check
          label="Excise tax"
          checked={value.otherLiabilities.exciseTax}
          onChange={(v) => set('otherLiabilities', { ...value.otherLiabilities, exciseTax: v })}
        />
        <Check
          label="Fringe benefits tax (1603Q)"
          checked={value.otherLiabilities.fringeBenefitsTax}
          onChange={(v) => set('otherLiabilities', { ...value.otherLiabilities, fringeBenefitsTax: v })}
        />
      </fieldset>

      {value.businessTaxRegime === 'vat' && (
        <Check
          label="We have mixed transactions (VATable + exempt/zero-rated) needing input-VAT allocation"
          checked={value.hasMixedTransactions}
          onChange={(v) => set('hasMixedTransactions', v)}
        />
      )}

      {showEffectiveFrom && (
        <Field
          label="Effective from"
          hint="The previous registration stays in force before this date — history is never rewritten."
        >
          <input
            type="date"
            className="input"
            value={value.effectiveFrom}
            onChange={(e) => set('effectiveFrom', e.target.value)}
          />
        </Field>
      )}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(v: boolean): void
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
      />
      {label}
    </label>
  )
}
