import { addDays, type ISODate } from './core'
import { rules } from '../tax/rules'
import { availableForms, type FormDescriptor } from '../reports/returns/registry'
import {
  isIndividualType,
  validateTaxProfile,
  type AccountingBasis,
  type BusinessTaxRegime,
  type EntityType,
  type EoptClassification,
  type IncomeTaxRegime,
  type RegisteredTaxType,
  type TaxProfile,
} from './taxProfile'

/**
 * Questionnaire → TaxProfile resolution. The wizard never lets the user pick
 * an invalid combination because each step's options are DERIVED from the
 * answers so far (a non-individual never sees the 8% option; choosing 8%
 * removes VAT from the business-tax step). `resolveProfile` then assembles a
 * profile that passes `validateTaxProfile` by construction — the matrix test
 * proves it over every reachable combination.
 */

export interface QuestionnaireAnswers {
  readonly entityType: EntityType
  readonly incomeTaxRegime: IncomeTaxRegime
  readonly businessTaxRegime: BusinessTaxRegime
  readonly hasEmployees: boolean
  readonly withholdsExpanded: boolean
  readonly withholdsFinal: boolean
  readonly isTopWithholdingAgent: boolean
  readonly isGovernmentPayor: boolean
  readonly otherLiabilities: TaxProfile['otherLiabilities']
  readonly accountingBasis: AccountingBasis
  readonly fiscalYearEndMonth: number
  readonly hasMixedTransactions: boolean
  /** Expected (or actual) annual gross — drives EOPT class and the 8% gate. */
  readonly expectedAnnualGrossCentavos: number
  readonly startOfOperations: ISODate | null
  readonly rdoCode: string
  readonly incentive?: TaxProfile['incentive']
  readonly effectiveFrom: ISODate
}

export function availableIncomeTaxRegimes(entityType: EntityType): IncomeTaxRegime[] {
  if (entityType === 'general_professional_partnership') return ['exempt']
  if (isIndividualType(entityType)) {
    return ['graduated_itemized', 'graduated_osd', 'eight_percent', 'exempt']
  }
  return ['rcit', 'income_tax_holiday', 'special_rate_incentive', 'exempt']
}

export function availableBusinessTaxRegimes(answers: {
  entityType: EntityType
  incomeTaxRegime: IncomeTaxRegime
}): BusinessTaxRegime[] {
  const all: BusinessTaxRegime[] = ['vat', 'non_vat_percentage', 'vat_exempt', 'vat_zero_rated']
  // The 8% election is closed to VAT registrants — remove it, don't validate it.
  if (answers.incomeTaxRegime === 'eight_percent') return all.filter((r) => r !== 'vat')
  return all
}

export function deriveEoptClassification(
  annualGrossCentavos: number,
  date: ISODate,
): EoptClassification {
  const t = rules.thresholds(date)
  if (annualGrossCentavos < t.eoptSmallFloorCentavos) return 'micro'
  if (annualGrossCentavos < t.eoptMediumFloorCentavos) return 'small'
  if (annualGrossCentavos < t.eoptLargeFloorCentavos) return 'medium'
  return 'large'
}

/** Assemble the TaxProfile. Inconsistent inputs are coerced, not rejected. */
export function resolveProfile(a: QuestionnaireAnswers): TaxProfile {
  const individual = isIndividualType(a.entityType)
  const isVat = a.businessTaxRegime === 'vat'
  // TWA status implies the expanded-withholding registration.
  const expanded = a.withholdsExpanded || a.isTopWithholdingAgent

  const registeredTaxTypes = new Set<RegisteredTaxType>(['income_tax'])
  if (isVat) registeredTaxTypes.add('vat')
  if (a.businessTaxRegime === 'non_vat_percentage') registeredTaxTypes.add('percentage_tax')
  if (expanded) registeredTaxTypes.add('withholding_expanded')
  if (a.withholdsFinal) registeredTaxTypes.add('withholding_final')
  if (a.hasEmployees) registeredTaxTypes.add('withholding_compensation')
  if (a.isGovernmentPayor) registeredTaxTypes.add('withholding_vat_government')
  if (a.otherLiabilities.documentaryStampTax) registeredTaxTypes.add('documentary_stamp_tax')
  if (a.otherLiabilities.exciseTax) registeredTaxTypes.add('excise_tax')
  if (a.otherLiabilities.fringeBenefitsTax) registeredTaxTypes.add('fringe_benefits_tax')

  const profile: TaxProfile = {
    entityType: a.entityType,
    incomeTaxRegime: a.incomeTaxRegime,
    businessTaxRegime: a.businessTaxRegime,
    registeredTaxTypes,
    withholdingAgent: {
      expanded,
      final: a.withholdsFinal,
      compensation: a.hasEmployees,
      governmentPayor: a.isGovernmentPayor,
      topWithholdingAgent: a.isTopWithholdingAgent,
    },
    otherLiabilities: a.otherLiabilities,
    accountingBasis: a.accountingBasis,
    fiscalYearEndMonth: individual ? 12 : a.fiscalYearEndMonth,
    hasMixedTransactions: isVat && a.hasMixedTransactions,
    eoptClassification: deriveEoptClassification(a.expectedAnnualGrossCentavos, a.effectiveFrom),
    startOfOperations: a.startOfOperations,
    rdoCode: a.rdoCode,
    ...(a.incentive ? { incentive: a.incentive } : {}),
    effectiveFrom: a.effectiveFrom,
    effectiveTo: null,
  }

  const problems = validateTaxProfile(profile)
  if (problems.length) {
    // Reachable answers can never trip this; it guards direct callers.
    throw new Error(`Resolved profile is invalid: ${problems.join('; ')}`)
  }
  return profile
}

export interface RegistrationSummary {
  readonly registeredTaxTypes: readonly RegisteredTaxType[]
  readonly forms: readonly FormDescriptor[]
  readonly notes: readonly string[]
}

/** What the review screen shows before the user confirms the registration. */
export function registrationSummary(profile: TaxProfile): RegistrationSummary {
  const notes: string[] = []
  if (profile.incomeTaxRegime === 'eight_percent') {
    notes.push(
      'The 8% election replaces both graduated income tax and percentage tax; the 2551Q is suppressed while it is in force.',
    )
  }
  if (profile.withholdingAgent.topWithholdingAgent) {
    notes.push('As a Top Withholding Agent, purchases of goods withhold 1% and services 2%.')
  }
  if (profile.hasMixedTransactions) {
    notes.push('Common input VAT will be allocated across vatable/exempt sales every quarter.')
  }
  return {
    registeredTaxTypes: [...profile.registeredTaxTypes].sort(),
    forms: availableForms(profile),
    notes,
  }
}

/**
 * Re-running the questionnaire later with a dated effectivity: the open
 * version closes the day before the new one starts, so a mid-year VAT
 * registration never rewrites history — prior periods still resolve to the
 * profile in force at the time.
 */
export function applyProfileRevision(
  existingVersions: readonly TaxProfile[],
  next: TaxProfile,
): { toSave: TaxProfile[] } {
  const open = existingVersions.find((v) => v.effectiveTo === null)
  if (!open) return { toSave: [next] }
  if (open.effectiveFrom === next.effectiveFrom) {
    // Same-day re-run: replace the version outright.
    return { toSave: [next] }
  }
  if (next.effectiveFrom <= open.effectiveFrom) {
    throw new Error(
      `The new effectivity (${next.effectiveFrom}) must be after the current version's start (${open.effectiveFrom})`,
    )
  }
  return {
    toSave: [{ ...open, effectiveTo: addDays(next.effectiveFrom, -1) }, next],
  }
}
