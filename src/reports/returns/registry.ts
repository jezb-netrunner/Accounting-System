import type { TaxProfile } from '../../domain/taxProfile'
import { isIndividualType } from '../../domain/taxProfile'

/**
 * Which return forms a profile can ever produce. The FilingCalendar decides
 * *when* they're due; this registry decides *what appears in the UI at all* —
 * the reason a non-VAT professional never sees a 2550Q anywhere.
 */

export interface FormDescriptor {
  readonly formCode: string
  readonly title: string
  readonly appliesTo: (profile: TaxProfile) => boolean
}

const reg = (profile: TaxProfile) => profile.registeredTaxTypes

export const FORM_REGISTRY: readonly FormDescriptor[] = [
  { formCode: '2550Q', title: 'Quarterly VAT Return', appliesTo: (p) => reg(p).has('vat') },
  {
    formCode: '2551Q',
    title: 'Quarterly Percentage Tax Return',
    appliesTo: (p) => reg(p).has('percentage_tax') && p.incomeTaxRegime !== 'eight_percent',
  },
  {
    formCode: '1701Q',
    title: 'Quarterly Income Tax (Individuals)',
    appliesTo: (p) => reg(p).has('income_tax') && isIndividualType(p.entityType) && p.incomeTaxRegime !== 'exempt',
  },
  {
    formCode: '1701',
    title: 'Annual Income Tax (Individuals / mixed income)',
    appliesTo: (p) =>
      reg(p).has('income_tax') &&
      isIndividualType(p.entityType) &&
      (p.entityType === 'mixed_income_individual' || p.incomeTaxRegime === 'graduated_itemized'),
  },
  {
    formCode: '1701A',
    title: 'Annual Income Tax (pure business/professional, OSD or 8%)',
    appliesTo: (p) =>
      reg(p).has('income_tax') &&
      isIndividualType(p.entityType) &&
      p.entityType !== 'mixed_income_individual' &&
      (p.incomeTaxRegime === 'graduated_osd' || p.incomeTaxRegime === 'eight_percent'),
  },
  {
    formCode: '1702Q',
    title: 'Quarterly Income Tax (Corporations)',
    appliesTo: (p) => reg(p).has('income_tax') && !isIndividualType(p.entityType) && p.incomeTaxRegime !== 'exempt',
  },
  {
    formCode: '1702-RT',
    title: 'Annual Income Tax (regular corporate rate)',
    appliesTo: (p) => !isIndividualType(p.entityType) && p.incomeTaxRegime === 'rcit' && !p.incentive,
  },
  {
    formCode: '1702-EX',
    title: 'Annual Income Tax (exempt corporations)',
    appliesTo: (p) =>
      !isIndividualType(p.entityType) &&
      (p.incomeTaxRegime === 'exempt' || p.incomeTaxRegime === 'income_tax_holiday'),
  },
  {
    formCode: '1702-MX',
    title: 'Annual Income Tax (mixed regimes / incentives)',
    appliesTo: (p) =>
      !isIndividualType(p.entityType) &&
      (p.incomeTaxRegime === 'special_rate_incentive' || Boolean(p.incentive)),
  },
  { formCode: '1601-C', title: 'Monthly WHT on Compensation', appliesTo: (p) => reg(p).has('withholding_compensation') },
  { formCode: '0619-E', title: 'Monthly EWT Remittance', appliesTo: (p) => reg(p).has('withholding_expanded') },
  { formCode: '0619-F', title: 'Monthly FWT Remittance', appliesTo: (p) => reg(p).has('withholding_final') },
  { formCode: '1601-EQ', title: 'Quarterly EWT Remittance Return', appliesTo: (p) => reg(p).has('withholding_expanded') },
  { formCode: '1601-FQ', title: 'Quarterly FWT Remittance Return', appliesTo: (p) => reg(p).has('withholding_final') },
  { formCode: '1604-C', title: 'Annual Info Return — Compensation', appliesTo: (p) => reg(p).has('withholding_compensation') },
  { formCode: '1604-E', title: 'Annual Info Return — EWT', appliesTo: (p) => reg(p).has('withholding_expanded') },
  { formCode: '1604-F', title: 'Annual Info Return — FWT', appliesTo: (p) => reg(p).has('withholding_final') },
  { formCode: '1603Q', title: 'Quarterly FBT Remittance', appliesTo: (p) => reg(p).has('fringe_benefits_tax') },
  { formCode: '2000', title: 'DST Declaration', appliesTo: (p) => reg(p).has('documentary_stamp_tax') },
  { formCode: '2000-OT', title: 'DST One-Time Transactions', appliesTo: (p) => reg(p).has('documentary_stamp_tax') },
  { formCode: '0605', title: 'Payment Form', appliesTo: () => true },
]

export const availableForms = (profile: TaxProfile): FormDescriptor[] =>
  FORM_REGISTRY.filter((f) => f.appliesTo(profile))
