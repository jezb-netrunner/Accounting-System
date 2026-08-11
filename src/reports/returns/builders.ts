import type { Company } from '../../data/ports'
import type { ISODate } from '../../domain/core'
import type { JournalEntry, JournalLine } from '../../domain/journal'
import type { TaxTag } from '../../domain/coa'
import type { TaxProfile } from '../../domain/taxProfile'
import { Money } from '../../lib/money'
import { rules } from '../../tax/rules'
import type {
  Form1601C,
  Form1601EQ,
  Form2550Q,
  Form2551Q,
  ReturnHeader,
} from './models'

/**
 * Return builders: ledger (tagged journal lines) → typed return model.
 * The tax tags on posted lines are the bridge — no account codes appear here.
 *
 * Implemented for the returns whose numbers fall straight out of the ledger
 * (2550Q, 2551Q, 1601-C, 1601-EQ). Income tax returns need year-to-date
 * carry-forward state and are stubbed at the model level until period close
 * data lands.
 */

export interface LedgerWindow {
  readonly entries: readonly JournalEntry[]
  readonly from: ISODate
  readonly to: ISODate
}

const header = (
  formCode: string,
  company: Company,
  profile: TaxProfile,
  w: LedgerWindow,
): ReturnHeader => ({
  formCode,
  tin: company.tin,
  registeredName: company.registeredName,
  rdoCode: profile.rdoCode,
  periodFrom: w.from,
  periodTo: w.to,
  amended: false,
})

/** Sum of (credit − debit) over lines with a tag — credit-normal accounts. */
export function creditSum(w: LedgerWindow, ...tags: TaxTag[]): Money {
  return foldLines(w, (l) =>
    tags.includes(l.taxTag) ? l.creditCentavos - l.debitCentavos : 0,
  )
}

/** Sum of (debit − credit) — debit-normal accounts. */
export function debitSum(w: LedgerWindow, ...tags: TaxTag[]): Money {
  return foldLines(w, (l) =>
    tags.includes(l.taxTag) ? l.debitCentavos - l.creditCentavos : 0,
  )
}

function foldLines(w: LedgerWindow, f: (l: JournalLine) => number): Money {
  let acc = 0
  for (const e of w.entries) {
    if (e.date < w.from || e.date > w.to) continue
    for (const l of e.lines) acc += f(l)
  }
  return Money.fromCentavos(acc)
}

export function build2550Q(company: Company, profile: TaxProfile, w: LedgerWindow): Form2550Q {
  const vatableSales = creditSum(w, 'sales_vatable')
  const outputVat = creditSum(w, 'output_vat')
  const inputVatCurrent = debitSum(w, 'input_vat')
  const inputVatOnCapitalGoods = debitSum(w, 'deferred_input_vat')
  const creditableVatWithheld = debitSum(w, 'creditable_wtax_receivable')
  const net = outputVat
    .subtract(inputVatCurrent)
    .subtract(inputVatOnCapitalGoods)
    .subtract(creditableVatWithheld)
  return {
    header: header('2550Q', company, profile, w),
    vatableSales,
    outputVat,
    zeroRatedSales: creditSum(w, 'sales_zero_rated'),
    exemptSales: creditSum(w, 'sales_exempt'),
    governmentSales: Money.ZERO, // needs per-party government split; see build.ts
    inputVatCarriedOver: Money.ZERO, // carry-forward state lives in build.ts
    inputVatCurrent,
    inputVatOnCapitalGoods,
    inputVatAllocatedToExempt: Money.ZERO, // allocateInputVat feeds this for mixed profiles
    creditableVatWithheld,
    netVatPayable: net.isNegative() ? Money.ZERO : net,
    excessInputVatCarryForward: net.isNegative() ? net.negate() : Money.ZERO,
  }
}

export function build2551Q(company: Company, profile: TaxProfile, w: LedgerWindow): Form2551Q {
  const gross = creditSum(w, 'sales_vatable', 'sales_exempt', 'sales_zero_rated')
  const rate = rules.percentageTax(w.to).rate
  const due = gross.multiply(rate)
  const withheld = debitSum(w, 'creditable_wtax_receivable')
  return {
    header: header('2551Q', company, profile, w),
    grossReceipts: gross,
    taxRatePercent: (rate.num / rate.den) * 100,
    percentageTaxDue: due,
    creditableTaxWithheld: withheld,
    totalPayable: due.subtract(withheld),
  }
}

export function build1601C(company: Company, profile: TaxProfile, w: LedgerWindow): Form1601C {
  const totalCompensation = debitSum(w, 'salaries_wages')
  const taxWithheld = creditSum(w, 'compensation_wtax_payable')
  return {
    header: header('1601-C', company, profile, w),
    totalCompensation,
    nonTaxableCompensation: Money.ZERO, // de-minimis/13th-month split needs payroll detail rows
    taxableCompensation: totalCompensation,
    taxWithheld,
    adjustments: Money.ZERO,
    totalRemittance: taxWithheld,
  }
}

export function build1601EQ(
  company: Company,
  profile: TaxProfile,
  w: LedgerWindow,
  options: { monthlyRemittances?: Money } = {},
): Form1601EQ {
  // ATC-level detail needs the source sheets (tags aggregate per account);
  // the quarterly total is ledger-true, rows land with the QAP writer.
  const totalTaxWithheld = creditSum(w, 'ewt_payable')
  const monthly = options.monthlyRemittances ?? Money.ZERO
  return {
    header: header('1601-EQ', company, profile, w),
    rows: [],
    totalTaxWithheld,
    monthlyRemittances: monthly,
    netRemittance: totalTaxWithheld.subtract(monthly),
  }
}
