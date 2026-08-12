import type { ISODate } from '../../domain/core'
import { Money, sum } from '../../lib/money'
import type { TaxProfile } from '../../domain/taxProfile'
import type { PayeeClass } from '../rules/withholding'
import { deriveVat, governmentVatWithholding, type VatClass } from './vat'
import { computeWithholding, type WithholdingResult } from './withholding'

/**
 * Per-line tax derivation, driven entirely by the TaxProfile. This is the
 * only place sheet entry talks to the tax engine, so nothing about VAT or
 * any single regime leaks into UI or posting code.
 */

export interface TaxLineInput {
  readonly amount: Money
  /** PH invoices are usually priced VAT-inclusive; false = amount is the net base. */
  readonly amountIsVatInclusive: boolean
  readonly vatClass: VatClass
  /** Withholding applies when an ATC is attached to the line. */
  readonly atc: string | null
}

export interface DocumentTaxContext {
  readonly profile: TaxProfile
  readonly direction: 'sale' | 'purchase'
  readonly date: ISODate
  readonly counterpartyClass: PayeeClass
  /** Government/GOCC counterparties withhold VAT (5%) and income tax at source. */
  readonly counterpartyIsGovernment: boolean
  /** Payee's cumulative gross this year, for two-tier ATC stepping. */
  readonly cumulativeAnnualGrossToPayee?: Money
  /** Company-defined ATC rows (master data) beyond the built-in matrix. */
  readonly customAtcRates?: readonly import('../rules/withholding').AtcRateRule[]
}

export interface DerivedTaxLine {
  readonly gross: Money
  readonly net: Money
  readonly vat: Money
  /** null when the company's regime keeps this document outside the VAT system. */
  readonly vatClass: VatClass | null
  readonly withholding: WithholdingResult | null
}

export function deriveLineTax(ctx: DocumentTaxContext, line: TaxLineInput): DerivedTaxLine {
  const companyInVatSystem = ctx.profile.businessTaxRegime === 'vat'

  // --- VAT side ---
  let gross = line.amount
  let net = line.amount
  let vat = Money.ZERO
  let vatClass: VatClass | null = null
  // Withholding always applies to the income payment excluding VAT, even
  // when the buyer is non-VAT and books the gross amount as cost.
  let withholdingBase = line.amount

  if (companyInVatSystem) {
    // Sales: output VAT per the line's class. Purchases: input VAT is only
    // creditable for a VAT-registered buyer, derived the same way.
    const breakdown = deriveVat(line.amount, line.vatClass, line.amountIsVatInclusive, ctx.date)
    gross = breakdown.gross
    net = breakdown.net
    vat = breakdown.vat
    vatClass = breakdown.vatClass
    withholdingBase = net
  } else {
    // Non-VAT company: sales carry no VAT (percentage tax is computed on the
    // return, not per line); purchase input VAT is not creditable, so the
    // full invoice amount is cost.
    vatClass = ctx.direction === 'sale' ? line.vatClass : null
    if (vatClass === 'vatable') vatClass = null // a non-VAT seller cannot charge output VAT
    if (ctx.direction === 'purchase' && line.vatClass === 'vatable' && line.amountIsVatInclusive) {
      // Strip the supplier's VAT for the withholding base only.
      withholdingBase = deriveVat(line.amount, 'vatable', true, ctx.date).net
    }
  }

  // --- Withholding side ---
  let withholding: WithholdingResult | null = null
  if (line.atc) {
    const isAgent =
      ctx.direction === 'purchase' &&
      (ctx.profile.withholdingAgent.expanded || ctx.profile.withholdingAgent.final)
    const isWithheldByCustomer = ctx.direction === 'sale' && ctx.counterpartyIsGovernment
    if (isAgent || isWithheldByCustomer) {
      withholding = computeWithholding(line.atc, withholdingBase, ctx.date, {
        cumulativeAnnualGross: ctx.cumulativeAnnualGrossToPayee,
        extraRates: ctx.customAtcRates,
      })
    }
  }

  return { gross, net, vat, vatClass, withholding }
}

export interface DocumentTaxTotals {
  readonly gross: Money
  readonly net: Money
  readonly vat: Money
  readonly vatableNet: Money
  readonly exemptNet: Money
  readonly zeroRatedNet: Money
  readonly withholdingTotal: Money
  /** 5% VAT withheld by a government payor on its purchase from us. */
  readonly governmentVatWithheld: Money
  /** Gross minus everything withheld = cash that actually moves. */
  readonly amountDue: Money
}

export function deriveDocumentTotals(
  ctx: DocumentTaxContext,
  lines: readonly TaxLineInput[],
): { lines: DerivedTaxLine[]; totals: DocumentTaxTotals } {
  const derived = lines.map((l) => deriveLineTax(ctx, l))
  const gross = sum(derived.map((d) => d.gross))
  const net = sum(derived.map((d) => d.net))
  const vat = sum(derived.map((d) => d.vat))
  const byClass = (c: VatClass) =>
    sum(derived.filter((d) => d.vatClass === c).map((d) => d.net))
  const withholdingTotal = sum(derived.map((d) => d.withholding?.amount ?? Money.ZERO))
  const governmentVatWithheld =
    ctx.direction === 'sale' &&
    ctx.counterpartyIsGovernment &&
    ctx.profile.businessTaxRegime === 'vat'
      ? governmentVatWithholding(byClass('vatable'), ctx.date)
      : Money.ZERO
  return {
    lines: derived,
    totals: {
      gross,
      net,
      vat,
      vatableNet: byClass('vatable'),
      exemptNet: byClass('exempt'),
      zeroRatedNet: byClass('zero_rated'),
      withholdingTotal,
      governmentVatWithheld,
      amountDue: gross.subtract(withholdingTotal).subtract(governmentVatWithheld),
    },
  }
}
