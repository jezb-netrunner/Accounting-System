import type { TaxProfile } from '../domain/taxProfile'
import { NOT_A_WITHHOLDING_AGENT } from '../domain/taxProfile'

/**
 * The three demo tax profiles. They exist so the differences between regimes
 * are visible immediately — and so tests can assert profile-driven behavior
 * against realistic configurations.
 */

/** VAT-registered domestic corporation with payroll (RCIT, full withholding-agent role). */
export const VAT_CORPORATION_PROFILE: TaxProfile = {
  entityType: 'domestic_corporation',
  incomeTaxRegime: 'rcit',
  businessTaxRegime: 'vat',
  registeredTaxTypes: new Set([
    'income_tax',
    'vat',
    'withholding_expanded',
    'withholding_compensation',
    'documentary_stamp_tax',
  ]),
  withholdingAgent: {
    expanded: true,
    final: false,
    compensation: true,
    governmentPayor: false,
    topWithholdingAgent: true,
  },
  otherLiabilities: { documentaryStampTax: true, exciseTax: false, fringeBenefitsTax: false },
  accountingBasis: 'accrual',
  fiscalYearEndMonth: 12,
  hasMixedTransactions: false,
  eoptClassification: 'medium',
  startOfOperations: '2019-06-01',
  rdoCode: '049',
  effectiveFrom: '2019-06-01',
  effectiveTo: null,
}

/** Self-employed professional on the 8% option, non-VAT. */
export const EIGHT_PERCENT_PROFESSIONAL_PROFILE: TaxProfile = {
  entityType: 'self_employed_professional',
  incomeTaxRegime: 'eight_percent',
  businessTaxRegime: 'non_vat_percentage',
  // The 8% election replaces percentage tax, but the taxpayer remains
  // registered for it (the election is annual; 2551Q shows the flag).
  registeredTaxTypes: new Set(['income_tax', 'percentage_tax']),
  withholdingAgent: NOT_A_WITHHOLDING_AGENT,
  otherLiabilities: { documentaryStampTax: false, exciseTax: false, fringeBenefitsTax: false },
  accountingBasis: 'cash',
  fiscalYearEndMonth: 12,
  hasMixedTransactions: false,
  eoptClassification: 'micro',
  startOfOperations: '2023-01-15',
  rdoCode: '039',
  effectiveFrom: '2023-01-15',
  effectiveTo: null,
}

/** Sole proprietor store on graduated rates + quarterly percentage tax. */
export const PERCENTAGE_TAX_SOLE_PROPRIETOR_PROFILE: TaxProfile = {
  entityType: 'sole_proprietor',
  incomeTaxRegime: 'graduated_osd',
  businessTaxRegime: 'non_vat_percentage',
  registeredTaxTypes: new Set(['income_tax', 'percentage_tax', 'withholding_expanded']),
  withholdingAgent: {
    expanded: true,
    final: false,
    compensation: false,
    governmentPayor: false,
    topWithholdingAgent: false,
  },
  otherLiabilities: { documentaryStampTax: false, exciseTax: false, fringeBenefitsTax: false },
  accountingBasis: 'accrual',
  fiscalYearEndMonth: 12,
  hasMixedTransactions: false,
  eoptClassification: 'small',
  startOfOperations: '2021-03-01',
  rdoCode: '050',
  effectiveFrom: '2021-03-01',
  effectiveTo: null,
}
