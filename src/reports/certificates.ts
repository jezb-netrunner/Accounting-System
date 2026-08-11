import type { ISODate, TIN } from '../domain/core'
import type { Money } from '../lib/money'

/**
 * Withholding certificate models. 2307 (creditable) and 2306 (final) go to
 * payees per quarter; 2316 goes to each employee annually. Renderers later;
 * these models are what the disbursement/payroll flows accumulate into.
 */

export interface CertificateParty {
  readonly tin: TIN
  readonly registeredName: string
  readonly address: string
  readonly zipCode: string
}

export interface Form2307 {
  readonly periodFrom: ISODate
  readonly periodTo: ISODate
  readonly payor: CertificateParty
  readonly payee: CertificateParty
  readonly rows: readonly {
    readonly atc: string
    readonly natureOfPayment: string
    /** Amounts by month of the quarter, BIR layout. */
    readonly monthAmounts: readonly [Money, Money, Money]
    readonly total: Money
    readonly taxWithheld: Money
  }[]
  readonly totalBase: Money
  readonly totalWithheld: Money
}

export interface Form2306 {
  readonly periodFrom: ISODate
  readonly periodTo: ISODate
  readonly payor: CertificateParty
  readonly payee: CertificateParty
  readonly atc: string
  readonly natureOfIncome: string
  readonly incomePayment: Money
  readonly finalTaxWithheld: Money
}

export interface Form2316 {
  readonly year: number
  readonly employer: CertificateParty
  readonly employee: CertificateParty & {
    readonly employeeNo: string
    readonly position: string
  }
  readonly compensationFrom: ISODate
  readonly compensationTo: ISODate
  readonly grossCompensation: Money
  readonly nonTaxable13thMonth: Money
  readonly nonTaxableDeMinimis: Money
  readonly statutoryContributions: Money
  readonly taxableCompensation: Money
  readonly taxDue: Money
  readonly taxWithheld: Money
  /** True when the employer's year-end adjustment made withheld == due. */
  readonly substitutedFiling: boolean
}
