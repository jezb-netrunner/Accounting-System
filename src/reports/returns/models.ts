import type { ISODate, TIN } from '../../domain/core'
import type { Money } from '../../lib/money'

/**
 * Typed models for BIR returns. Field sets cover the computational core of
 * each form (the parts the ledger can fill); cosmetic header fields ride on
 * ReturnHeader. Renderers turn these into files later — the models are the
 * contract.
 */

export interface ReturnHeader {
  readonly formCode: string
  readonly tin: TIN
  readonly registeredName: string
  readonly rdoCode: string
  readonly periodFrom: ISODate
  readonly periodTo: ISODate
  readonly amended: boolean
}

export interface Form2550Q {
  readonly header: ReturnHeader
  readonly vatableSales: Money
  readonly outputVat: Money
  readonly zeroRatedSales: Money
  readonly exemptSales: Money
  readonly governmentSales: Money
  readonly inputVatCarriedOver: Money
  readonly inputVatCurrent: Money
  readonly inputVatOnCapitalGoods: Money
  readonly inputVatAllocatedToExempt: Money
  readonly creditableVatWithheld: Money
  readonly netVatPayable: Money
  /** Excess credits carried to the next quarter (0 when a payable exists). */
  readonly excessInputVatCarryForward: Money
}

export interface Form2551Q {
  readonly header: ReturnHeader
  readonly grossReceipts: Money
  readonly taxRatePercent: number
  readonly percentageTaxDue: Money
  readonly creditableTaxWithheld: Money
  readonly totalPayable: Money
}

export interface Form1601C {
  readonly header: ReturnHeader
  readonly totalCompensation: Money
  readonly nonTaxableCompensation: Money
  readonly taxableCompensation: Money
  readonly taxWithheld: Money
  readonly adjustments: Money
  readonly totalRemittance: Money
}

export interface AtcSummaryRow {
  readonly atc: string
  readonly natureOfPayment: string
  readonly taxBase: Money
  readonly taxWithheld: Money
}

export interface Form1601EQ {
  readonly header: ReturnHeader
  readonly rows: readonly AtcSummaryRow[]
  readonly totalTaxWithheld: Money
  readonly monthlyRemittances: Money // 0619-E payments for months 1-2
  readonly netRemittance: Money
}

export type Form1601FQ = Form1601EQ

export interface Form0619 {
  readonly header: ReturnHeader
  readonly variant: 'E' | 'F'
  readonly taxWithheld: Money
}

export interface Form1701Q {
  readonly header: ReturnHeader
  readonly method: 'graduated' | 'eight_percent'
  readonly grossReceipts: Money
  readonly deductions: Money
  readonly taxableIncomeToDate: Money
  readonly taxDueToDate: Money
  readonly priorQuartersPayments: Money
  readonly creditableWithheld: Money
  readonly netPayable: Money
}

export interface Form1701 {
  readonly header: ReturnHeader
  readonly variant: '1701' | '1701A'
  readonly method: 'graduated' | 'eight_percent'
  readonly grossReceipts: Money
  readonly costOfSales: Money
  readonly deductions: Money
  readonly taxableCompensation: Money
  readonly taxableIncome: Money
  readonly taxDue: Money
  readonly creditsAndPayments: Money
  readonly netPayable: Money
}

export interface Form1702Q {
  readonly header: ReturnHeader
  readonly grossIncome: Money
  readonly deductions: Money
  readonly taxableIncomeToDate: Money
  readonly rcit: Money
  readonly mcit: Money
  readonly taxDueToDate: Money
  readonly priorQuartersPayments: Money
  readonly creditableWithheld: Money
  readonly netPayable: Money
}

export interface Form1702 {
  readonly header: ReturnHeader
  readonly variant: 'RT' | 'EX' | 'MX'
  readonly grossIncome: Money
  readonly deductions: Money
  readonly taxableIncome: Money
  readonly rcit: Money
  readonly mcit: Money
  readonly incentiveRateTax: Money
  readonly taxDue: Money
  readonly creditsAndPayments: Money
  readonly netPayable: Money
}

export interface AlphalistEntryRow {
  readonly seq: number
  readonly tin: TIN
  readonly name: string
  readonly atc: string
  readonly taxBase: Money
  readonly ratePercent: number
  readonly taxWithheld: Money
}

export interface Form1604 {
  readonly header: ReturnHeader
  readonly variant: 'C' | 'E' | 'F'
  readonly rows: readonly AlphalistEntryRow[]
  readonly totalBase: Money
  readonly totalWithheld: Money
}

export interface Form0605 {
  readonly header: ReturnHeader
  readonly taxType: string
  readonly amount: Money
}

export interface Form2000 {
  readonly header: ReturnHeader
  readonly variant: '2000' | '2000-OT'
  readonly documents: readonly { section: string; description: string; base: Money; dst: Money }[]
  readonly totalDst: Money
}

export type ReturnModel =
  | Form2550Q
  | Form2551Q
  | Form1601C
  | Form1601EQ
  | Form0619
  | Form1701Q
  | Form1701
  | Form1702Q
  | Form1702
  | Form1604
  | Form0605
  | Form2000

/**
 * Renderer contract: a renderer turns a typed model into a distributable
 * artifact (PDF, eBIRForms XML, JSON for eFPS). Stub renderers exist so the
 * pipeline is wired end-to-end before real formats land.
 */
export interface FormRenderer<T> {
  readonly targetFormat: 'pdf' | 'ebirforms-xml' | 'json'
  render(model: T): Blob | string
}

export class RendererNotImplementedError extends Error {
  constructor(formCode: string, format: string) {
    super(`Renderer for ${formCode} (${format}) is not implemented yet — model is ready, format pending`)
  }
}

/** Placeholder renderer: serializes the typed model as JSON for inspection. */
export function stubRenderer<T>(formCode: string): FormRenderer<T> {
  return {
    targetFormat: 'json',
    render(model: T): string {
      return JSON.stringify({ formCode, model }, null, 2)
    },
  }
}
