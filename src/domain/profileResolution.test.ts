import { describe, expect, it } from 'vitest'
import {
  applyProfileRevision,
  availableBusinessTaxRegimes,
  availableIncomeTaxRegimes,
  deriveEoptClassification,
  registrationSummary,
  resolveProfile,
  type QuestionnaireAnswers,
} from './profileResolution'
import { validateTaxProfile, type TaxProfile } from './taxProfile'

const answers = (over: Partial<QuestionnaireAnswers> = {}): QuestionnaireAnswers => ({
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
  expectedAnnualGrossCentavos: 200_000_000,
  startOfOperations: '2024-01-01',
  rdoCode: '050',
  effectiveFrom: '2026-01-01',
  ...over,
})

describe('availableIncomeTaxRegimes (invalid combos are unreachable)', () => {
  it('offers individuals the graduated and 8% regimes, never RCIT', () => {
    const r = availableIncomeTaxRegimes('self_employed_professional')
    expect(r).toContain('eight_percent')
    expect(r).toContain('graduated_itemized')
    expect(r).not.toContain('rcit')
  })

  it('offers corporations RCIT and incentives, never 8% or graduated', () => {
    const r = availableIncomeTaxRegimes('domestic_corporation')
    expect(r).toContain('rcit')
    expect(r).not.toContain('eight_percent')
    expect(r).not.toContain('graduated_osd')
  })

  it('a GPP gets no corporate regimes — entity-level exempt only', () => {
    expect(availableIncomeTaxRegimes('general_professional_partnership')).toEqual(['exempt'])
  })
})

describe('availableBusinessTaxRegimes', () => {
  it('removes VAT once the 8% option is chosen', () => {
    const r = availableBusinessTaxRegimes({
      entityType: 'self_employed_professional',
      incomeTaxRegime: 'eight_percent',
    })
    expect(r).not.toContain('vat')
    expect(r).toContain('non_vat_percentage')
  })

  it('keeps VAT available under the graduated regimes', () => {
    expect(
      availableBusinessTaxRegimes({
        entityType: 'sole_proprietor',
        incomeTaxRegime: 'graduated_itemized',
      }),
    ).toContain('vat')
  })
})

describe('deriveEoptClassification', () => {
  it('classifies by the thresholds table', () => {
    expect(deriveEoptClassification(200_000_000, '2026-01-01')).toBe('micro') // ₱2M
    expect(deriveEoptClassification(500_000_000, '2026-01-01')).toBe('small') // ₱5M
    expect(deriveEoptClassification(5_000_000_000, '2026-01-01')).toBe('medium') // ₱50M
    expect(deriveEoptClassification(200_000_000_000, '2026-01-01')).toBe('large') // ₱2B
  })
})

describe('resolveProfile', () => {
  it('derives a valid registration from 8% professional answers', () => {
    const p = resolveProfile(
      answers({
        entityType: 'self_employed_professional',
        incomeTaxRegime: 'eight_percent',
        accountingBasis: 'cash',
      }),
    )
    expect(p.registeredTaxTypes.has('percentage_tax')).toBe(true)
    expect(p.registeredTaxTypes.has('vat')).toBe(false)
    expect(validateTaxProfile(p)).toEqual([])
  })

  it('turns employees into compensation withholding registration', () => {
    const p = resolveProfile(answers({ hasEmployees: true }))
    expect(p.withholdingAgent.compensation).toBe(true)
    expect(p.registeredTaxTypes.has('withholding_compensation')).toBe(true)
  })

  it('forces expanded withholding on for Top Withholding Agents', () => {
    const p = resolveProfile(answers({ isTopWithholdingAgent: true, withholdsExpanded: false }))
    expect(p.withholdingAgent.topWithholdingAgent).toBe(true)
    expect(p.withholdingAgent.expanded).toBe(true)
    expect(p.registeredTaxTypes.has('withholding_expanded')).toBe(true)
  })

  it('forces the calendar year on individuals', () => {
    const p = resolveProfile(answers({ fiscalYearEndMonth: 6 }))
    expect(p.fiscalYearEndMonth).toBe(12)
  })

  it('keeps a fiscal year for corporations', () => {
    const p = resolveProfile(
      answers({
        entityType: 'domestic_corporation',
        incomeTaxRegime: 'rcit',
        businessTaxRegime: 'vat',
        fiscalYearEndMonth: 6,
      }),
    )
    expect(p.fiscalYearEndMonth).toBe(6)
  })

  it('limits mixed-transaction handling to VAT registrants', () => {
    const nonVat = resolveProfile(answers({ hasMixedTransactions: true }))
    expect(nonVat.hasMixedTransactions).toBe(false)
    const vat = resolveProfile(
      answers({
        entityType: 'domestic_corporation',
        incomeTaxRegime: 'rcit',
        businessTaxRegime: 'vat',
        hasMixedTransactions: true,
      }),
    )
    expect(vat.hasMixedTransactions).toBe(true)
  })

  it('produces a valid profile for EVERY reachable questionnaire combination', () => {
    const entityTypes: QuestionnaireAnswers['entityType'][] = [
      'sole_proprietor',
      'self_employed_professional',
      'mixed_income_individual',
      'general_professional_partnership',
      'partnership',
      'domestic_corporation',
      'one_person_corporation',
      'cooperative',
      'non_stock_non_profit',
    ]
    for (const entityType of entityTypes) {
      for (const incomeTaxRegime of availableIncomeTaxRegimes(entityType)) {
        for (const businessTaxRegime of availableBusinessTaxRegimes({ entityType, incomeTaxRegime })) {
          for (const hasEmployees of [false, true]) {
            const p = resolveProfile(
              answers({
                entityType,
                incomeTaxRegime,
                businessTaxRegime,
                hasEmployees,
                fiscalYearEndMonth: 6,
                isTopWithholdingAgent: entityType === 'domestic_corporation',
                otherLiabilities: {
                  documentaryStampTax: true,
                  exciseTax: false,
                  fringeBenefitsTax: hasEmployees,
                },
                incentive:
                  incomeTaxRegime === 'income_tax_holiday' ||
                  incomeTaxRegime === 'special_rate_incentive'
                    ? { agency: 'PEZA', registrationNo: 'X-1', validFrom: '2024-01-01', validTo: null }
                    : undefined,
              }),
            )
            expect(
              validateTaxProfile(p),
              `${entityType}/${incomeTaxRegime}/${businessTaxRegime}`,
            ).toEqual([])
          }
        }
      }
    }
  })
})

describe('registrationSummary', () => {
  it('lists the derived registrations and available forms for review', () => {
    const p = resolveProfile(
      answers({
        entityType: 'domestic_corporation',
        incomeTaxRegime: 'rcit',
        businessTaxRegime: 'vat',
        hasEmployees: true,
        withholdsExpanded: true,
      }),
    )
    const s = registrationSummary(p)
    expect(s.registeredTaxTypes).toContain('vat')
    expect(s.forms.some((f) => f.formCode === '2550Q')).toBe(true)
    expect(s.forms.some((f) => f.formCode === '2551Q')).toBe(false)
    expect(s.forms.some((f) => f.formCode === '1601-C')).toBe(true)
  })
})

describe('applyProfileRevision (dated effectivity, history preserved)', () => {
  const v1: TaxProfile = resolveProfile(answers({ effectiveFrom: '2025-01-01' }))

  it('closes the open version the day before the new one starts', () => {
    const v2 = resolveProfile(
      answers({ businessTaxRegime: 'vat', incomeTaxRegime: 'graduated_itemized', effectiveFrom: '2026-07-01' }),
    )
    const { toSave } = applyProfileRevision([v1], v2)
    expect(toSave).toHaveLength(2)
    expect(toSave[0]!.effectiveTo).toBe('2026-06-30')
    expect(toSave[1]!.effectiveFrom).toBe('2026-07-01')
    expect(toSave[1]!.effectiveTo).toBeNull()
  })

  it('replaces outright when the effectivity date is unchanged', () => {
    const v2 = resolveProfile(answers({ accountingBasis: 'cash', effectiveFrom: '2025-01-01' }))
    const { toSave } = applyProfileRevision([v1], v2)
    expect(toSave).toHaveLength(1)
    expect(toSave[0]!.accountingBasis).toBe('cash')
  })

  it('rejects a revision dated before the open version starts', () => {
    const v2 = resolveProfile(answers({ effectiveFrom: '2024-06-01' }))
    expect(() => applyProfileRevision([v1], v2)).toThrow(/after/)
  })
})
