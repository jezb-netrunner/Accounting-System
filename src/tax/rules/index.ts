import type { ISODate } from '../../domain/core'
import { CORPORATE_TAX_RULES, type CorporateTaxRuleBlock } from './corporate'
import { DST_RULES, type DstRuleBlock } from './dst'
import {
  INDIVIDUAL_INCOME_TAX_RULES,
  type IndividualIncomeTaxRuleBlock,
} from './incomeTaxIndividual'
import { PERCENTAGE_TAX_RULES, type PercentageTaxRuleBlock } from './percentageTax'
import { resolveEffective } from './types'
import { THRESHOLD_RULES, type ThresholdRuleBlock } from './thresholds'
import { VAT_RULES, type VatRuleBlock } from './vat'
import {
  COMPENSATION_WITHHOLDING_RULES,
  WITHHOLDING_RULES,
  type AtcRateRule,
  type CompensationWithholdingRuleBlock,
  type PayeeClass,
  type WithholdingRuleBlock,
} from './withholding'

export * from './types'
export * from './vat'
export * from './percentageTax'
export * from './incomeTaxIndividual'
export * from './corporate'
export * from './withholding'
export * from './dst'
export * from './thresholds'

/**
 * One façade the engine talks to. Resolution is always by transaction date,
 * so historical periods compute with the rules in force at the time.
 */
export const rules = {
  vat: (date: ISODate): VatRuleBlock => resolveEffective(VAT_RULES, date, 'VAT'),
  percentageTax: (date: ISODate): PercentageTaxRuleBlock =>
    resolveEffective(PERCENTAGE_TAX_RULES, date, 'percentage tax'),
  individualIncomeTax: (date: ISODate): IndividualIncomeTaxRuleBlock =>
    resolveEffective(INDIVIDUAL_INCOME_TAX_RULES, date, 'individual income tax'),
  corporateTax: (date: ISODate): CorporateTaxRuleBlock =>
    resolveEffective(CORPORATE_TAX_RULES, date, 'corporate tax'),
  withholding: (date: ISODate): WithholdingRuleBlock =>
    resolveEffective(WITHHOLDING_RULES, date, 'withholding'),
  compensationWithholding: (date: ISODate): CompensationWithholdingRuleBlock =>
    resolveEffective(COMPENSATION_WITHHOLDING_RULES, date, 'compensation withholding'),
  dst: (date: ISODate): DstRuleBlock => resolveEffective(DST_RULES, date, 'DST'),
  thresholds: (date: ISODate): ThresholdRuleBlock =>
    resolveEffective(THRESHOLD_RULES, date, 'thresholds'),

  /** Look up an ATC rate row valid on `date`; undefined when the ATC is unknown. */
  atc(date: ISODate, atc: string): AtcRateRule | undefined {
    return rules.withholding(date).atcRates.find((r) => r.atc === atc)
  },

  /** All ATCs applicable to a payee class on `date` (for pickers). */
  atcsForPayee(date: ISODate, payeeClass: PayeeClass): readonly AtcRateRule[] {
    return rules.withholding(date).atcRates.filter((r) => r.payeeClass === payeeClass)
  },
}
