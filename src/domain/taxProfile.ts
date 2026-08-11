/**
 * TaxProfile — the single source of truth for how a company is taxed.
 *
 * Nothing downstream (engine, filing calendar, forms, UI) may hardcode a
 * regime; everything derives from this profile, resolved at company setup and
 * versioned over time (a company can convert from non-VAT to VAT mid-year).
 */
import type { ISODate } from './core'

export type EntityType =
  | 'sole_proprietor'
  | 'self_employed_professional'
  | 'mixed_income_individual'
  | 'estate'
  | 'trust'
  | 'general_professional_partnership'
  | 'partnership' // non-GPP, taxed as a corporation
  | 'domestic_corporation'
  | 'one_person_corporation'
  | 'resident_foreign_corporation'
  | 'branch_office'
  | 'representative_office'
  | 'cooperative'
  | 'non_stock_non_profit'

export const INDIVIDUAL_ENTITY_TYPES: readonly EntityType[] = [
  'sole_proprietor',
  'self_employed_professional',
  'mixed_income_individual',
  'estate',
  'trust',
]

export const isIndividualType = (e: EntityType): boolean => INDIVIDUAL_ENTITY_TYPES.includes(e)

export const isCorporateType = (e: EntityType): boolean =>
  !isIndividualType(e) && e !== 'general_professional_partnership'

export type IncomeTaxRegime =
  /** Graduated rates, itemized deductions (individuals). */
  | 'graduated_itemized'
  /** Graduated rates, 40% optional standard deduction (individuals). */
  | 'graduated_osd'
  /** 8% of gross sales/receipts in lieu of graduated income tax + percentage tax. */
  | 'eight_percent'
  /** Regular corporate income tax (25%, or 20% for qualifying small domestic corps). */
  | 'rcit'
  /** Income tax holiday under an investment-promotion incentive. */
  | 'income_tax_holiday'
  /** 5% special corporate/gross-income tax under incentives (SCIT/GIT). */
  | 'special_rate_incentive'
  /** Exempt entities (GPP at entity level, qualified coops/non-profits). */
  | 'exempt'

export type BusinessTaxRegime =
  | 'vat' // VAT-registered, 12% standard
  | 'non_vat_percentage' // percentage tax under Sec 116
  | 'vat_exempt' // exempt transactions only, no business tax
  | 'vat_zero_rated' // predominantly zero-rated/effectively-zero-rated (e.g. registered exporter)

/**
 * BIR tax types a company can be registered for. Registration is multi-line:
 * one company holds several simultaneously, each driving its own filing
 * calendar — modeled as a set, never a single enum value.
 */
export type RegisteredTaxType =
  | 'income_tax'
  | 'vat'
  | 'percentage_tax'
  | 'withholding_expanded'
  | 'withholding_final'
  | 'withholding_compensation'
  | 'withholding_vat_government' // 5% final VAT withholding on government payments
  | 'withholding_percentage_government'
  | 'documentary_stamp_tax'
  | 'excise_tax'
  | 'fringe_benefits_tax'

export type AccountingBasis = 'accrual' | 'cash'

/** Withholding agent posture, derived from registrations + TWA listing. */
export interface WithholdingAgentProfile {
  /** Registered to withhold expanded/creditable tax on income payments. */
  readonly expanded: boolean
  /** Registered to withhold final taxes. */
  readonly final: boolean
  /** Has employees; withholds tax on compensation. */
  readonly compensation: boolean
  /** Government entity or GOCC withholding VAT/percentage tax on payments. */
  readonly governmentPayor: boolean
  /** Published Top Withholding Agent: must withhold 1%/2% on purchases of goods/services. */
  readonly topWithholdingAgent: boolean
}

export const NOT_A_WITHHOLDING_AGENT: WithholdingAgentProfile = {
  expanded: false,
  final: false,
  compensation: false,
  governmentPayor: false,
  topWithholdingAgent: false,
}

/**
 * EOPT (RA 11976) taxpayer classification. Boundaries live in the rules
 * tables (they are peso thresholds subject to periodic adjustment), so this
 * is a label, not a number.
 */
export type EoptClassification = 'micro' | 'small' | 'medium' | 'large'

export interface TaxProfile {
  readonly entityType: EntityType
  readonly incomeTaxRegime: IncomeTaxRegime
  readonly businessTaxRegime: BusinessTaxRegime

  /** Multi-line registration: drives the filing calendar. A set, never an enum. */
  readonly registeredTaxTypes: ReadonlySet<RegisteredTaxType>

  readonly withholdingAgent: WithholdingAgentProfile

  /** Other liabilities, flagged on/off. */
  readonly otherLiabilities: {
    readonly documentaryStampTax: boolean
    readonly exciseTax: boolean
    readonly fringeBenefitsTax: boolean
  }

  readonly accountingBasis: AccountingBasis
  /** Month (1-12) the fiscal year ends in; 12 = calendar year. Individuals must be 12. */
  readonly fiscalYearEndMonth: number

  /**
   * A VAT-registered company with exempt and/or zero-rated sales alongside
   * vatable ones. Triggers input-VAT allocation on mixed-use purchases.
   */
  readonly hasMixedTransactions: boolean

  readonly eoptClassification: EoptClassification

  /** MCIT starts on the 4th taxable year from start of operations (corporations). */
  readonly startOfOperations: ISODate | null

  /** BIR Revenue District Office code, e.g. "050". */
  readonly rdoCode: string

  /** Incentive registration details when incomeTaxRegime is ITH/special rate. */
  readonly incentive?: {
    readonly agency: 'PEZA' | 'BOI' | 'other'
    readonly registrationNo: string
    readonly validFrom: ISODate
    readonly validTo: ISODate | null
  }

  /** Profile versioning: effective window for mid-year regime changes. */
  readonly effectiveFrom: ISODate
  readonly effectiveTo: ISODate | null
}

/** Cross-field consistency rules a profile must satisfy. */
export function validateTaxProfile(p: TaxProfile): string[] {
  const errors: string[] = []
  const individual = isIndividualType(p.entityType)

  if (p.fiscalYearEndMonth < 1 || p.fiscalYearEndMonth > 12) {
    errors.push('fiscalYearEndMonth must be 1-12')
  }
  if (individual && p.fiscalYearEndMonth !== 12) {
    errors.push('Individuals must use the calendar year (fiscal year end month 12)')
  }
  if (p.incomeTaxRegime === 'eight_percent') {
    if (!individual) errors.push('The 8% option is available only to individuals')
    if (p.businessTaxRegime === 'vat') {
      errors.push('The 8% option is not available to VAT-registered taxpayers')
    }
    if (p.entityType === 'general_professional_partnership') {
      errors.push('GPP partners, not the GPP, may elect 8%')
    }
  }
  if (p.incomeTaxRegime === 'rcit' && individual) {
    errors.push('RCIT applies to corporations, not individuals')
  }
  if (
    (p.incomeTaxRegime === 'graduated_itemized' || p.incomeTaxRegime === 'graduated_osd') &&
    !individual &&
    p.entityType !== 'general_professional_partnership'
  ) {
    errors.push('Graduated rates apply to individuals (corporations use RCIT/MCIT)')
  }
  if (p.businessTaxRegime === 'vat' !== p.registeredTaxTypes.has('vat')) {
    errors.push('businessTaxRegime and registeredTaxTypes disagree about VAT registration')
  }
  if (p.businessTaxRegime === 'non_vat_percentage' && !p.registeredTaxTypes.has('percentage_tax')) {
    errors.push('Percentage-tax regime requires percentage_tax in registeredTaxTypes')
  }
  if (p.registeredTaxTypes.has('vat') && p.registeredTaxTypes.has('percentage_tax')) {
    errors.push('A taxpayer cannot be registered for both VAT and percentage tax')
  }
  if (p.withholdingAgent.compensation !== p.registeredTaxTypes.has('withholding_compensation')) {
    errors.push('withholdingAgent.compensation and registeredTaxTypes disagree')
  }
  if (
    (p.incomeTaxRegime === 'income_tax_holiday' || p.incomeTaxRegime === 'special_rate_incentive') &&
    !p.incentive
  ) {
    errors.push('Incentive regimes require incentive registration details')
  }
  if (p.otherLiabilities.fringeBenefitsTax && !p.registeredTaxTypes.has('fringe_benefits_tax')) {
    errors.push('FBT flagged on but fringe_benefits_tax missing from registeredTaxTypes')
  }
  return errors
}
