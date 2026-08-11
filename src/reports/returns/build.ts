import { formatTIN, periodOfDate, type ISODate } from '../../domain/core'
import { isIndividualType } from '../../domain/taxProfile'
import { Money, sum } from '../../lib/money'
import { computePercentageTaxQuarter } from '../../tax/engine/percentageTax'
import { computeVatPeriod } from '../../tax/engine/vatPeriod'
import {
  annualizeYearEnd,
  atcSummary,
  certificateData,
  computePayrollWithholding,
  qapEntries,
  withholdingForMonth,
  withholdingForRange,
  type WithholdingTxn,
} from '../../tax/engine/withholdingPeriod'
import {
  computeCorporateQuarterlyTax,
  computeIndividualQuarterlyTax,
} from '../../tax/engine/incomeTaxPeriod'
import { computeCorporateIncomeTax, computeIndividualIncomeTax } from '../../tax/engine/incomeTax'
import { rules } from '../../tax/rules'
import type {
  AnnualAlphalistModel,
  QapModel,
  SawtModel,
  SlspModel,
  SlspRow,
} from '../attachments/datWriter'
import type { CertificateParty, Form2306, Form2307, Form2316 } from '../certificates'
import {
  cashReceipts,
  collectWithholdingTxns,
  priorFigure,
  purchaseDocuments,
  saleDocuments,
  sumPriorFiguresInYear,
  type ReturnContext,
} from './context'
import type {
  Form0619,
  Form1601C,
  Form1601EQ,
  Form1604,
  Form1701,
  Form1701Q,
  Form1702,
  Form1702Q,
  Form2550Q,
  Form2551Q,
  ReturnHeader,
} from './models'

/**
 * Context-based return builders: computed figures mapped onto the actual
 * form line items, with carry-forward state read from previously generated
 * returns. Every builder returns the typed model plus the figures snapshot
 * (centavos) persisted with the generated return.
 */

export interface BuiltReturn<T> {
  readonly model: T
  readonly figures: Record<string, number>
}

const header = (formCode: string, ctx: ReturnContext, from: ISODate, to: ISODate): ReturnHeader => ({
  formCode,
  tin: ctx.company.tin,
  registeredName: ctx.company.registeredName,
  rdoCode: ctx.profile.rdoCode,
  periodFrom: from,
  periodTo: to,
  amended: false,
})

// ---------------- VAT: 2550Q ----------------

export function buildReturn2550Q(
  ctx: ReturnContext,
  from: ISODate,
  to: ISODate,
  overrides: { amortizedInputVatCentavos?: number } = {},
): BuiltReturn<Form2550Q> {
  const sales = saleDocuments(ctx, from, to)
  const purchases = purchaseDocuments(ctx, from, to)
  const signed = (m: Money, sign: number) => (sign < 0 ? m.negate() : m)

  const vatableSales = sum(sales.map((s) => signed(s.totals.vatableNet, s.sign)))
  const zeroRatedSales = sum(sales.map((s) => signed(s.totals.zeroRatedNet, s.sign)))
  const exemptSales = sum(sales.map((s) => signed(s.totals.exemptNet, s.sign)))
  const outputVat = sum(sales.map((s) => signed(s.totals.vat, s.sign)))
  const governmentSales = sum(
    sales.filter((s) => s.party?.isGovernment).map((s) => signed(s.totals.vatableNet, s.sign)),
  )
  const vatWithheldByGovernment = sum(
    sales.map((s) => signed(s.totals.governmentVatWithheld, s.sign)),
  )
  const inputVatCurrent = sum(purchases.map((p) => signed(p.totals.vat, p.sign)))
  const amortized = Money.fromCentavos(overrides.amortizedInputVatCentavos ?? 0)
  const carriedOver = priorFigure(ctx, '2550Q', from, 'excessInputVatCarryForward')

  // Mixed-transaction profiles allocate the period's input VAT by the sales
  // mix (Sec. 110(A)(3)); a purely-vatable profile credits it all.
  const period = computeVatPeriod({
    outputVat,
    inputVatDirectTaxable: ctx.profile.hasMixedTransactions ? Money.ZERO : inputVatCurrent,
    inputVatDirectExempt: Money.ZERO,
    inputVatCommon: ctx.profile.hasMixedTransactions ? inputVatCurrent : Money.ZERO,
    amortizedInputVatThisPeriod: amortized,
    sales: { vatable: vatableSales, zeroRated: zeroRatedSales, exempt: exemptSales },
    excessInputVatCarriedForward: carriedOver,
    vatWithheldByGovernment,
  })

  const model: Form2550Q = {
    header: header('2550Q', ctx, from, to),
    vatableSales,
    outputVat,
    zeroRatedSales,
    exemptSales,
    governmentSales,
    inputVatCarriedOver: carriedOver,
    inputVatCurrent,
    inputVatOnCapitalGoods: amortized,
    inputVatAllocatedToExempt: period.inputVatExpensed,
    creditableVatWithheld: vatWithheldByGovernment,
    netVatPayable: period.netVatPayable,
    excessInputVatCarryForward: period.excessInputVatCarryForward,
  }
  return {
    model,
    figures: {
      vatableSales: vatableSales.centavos,
      outputVat: outputVat.centavos,
      inputVatCurrent: inputVatCurrent.centavos,
      netVatPayable: period.netVatPayable.centavos,
      excessInputVatCarryForward: period.excessInputVatCarryForward.centavos,
    },
  }
}

// ---------------- Percentage tax: 2551Q ----------------

export function buildReturn2551Q(ctx: ReturnContext, from: ISODate, to: ISODate): BuiltReturn<Form2551Q> {
  const sales = saleDocuments(ctx, from, to)
  const accrued = sum(sales.map((s) => (s.sign < 0 ? s.totals.net.negate() : s.totals.net)))
  const collected = cashReceipts(ctx, from, to)
  const q = computePercentageTaxQuarter(
    { basis: ctx.profile.accountingBasis, accruedGrossSales: accrued, cashCollections: collected },
    to,
  )
  // Percentage tax withheld by government payors (creditable) — from sale docs.
  const withheld = sum(sales.map((s) => (s.sign < 0 ? s.totals.withholdingTotal.negate() : s.totals.withholdingTotal)))
  const model: Form2551Q = {
    header: header('2551Q', ctx, from, to),
    grossReceipts: q.base,
    taxRatePercent: (q.rate.num / q.rate.den) * 100,
    percentageTaxDue: q.tax,
    creditableTaxWithheld: withheld,
    totalPayable: q.tax.subtract(withheld),
  }
  return {
    model,
    figures: {
      grossReceipts: q.base.centavos,
      percentageTaxDue: q.tax.centavos,
      totalPayable: q.tax.subtract(withheld).centavos,
    },
  }
}

// ---------------- Withholding remittances ----------------

export function buildReturn0619(
  ctx: ReturnContext,
  year: number,
  month: number,
  variant: 'E' | 'F',
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): BuiltReturn<Form0619> {
  const kind = variant === 'E' ? 'expanded' : 'final'
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const taxWithheld = withholdingForMonth(txns, year, month, kind)
  const to = `${year}-${String(month).padStart(2, '0')}-28`
  const model: Form0619 = {
    header: header(`0619-${variant}`, ctx, from, to),
    variant,
    taxWithheld,
  }
  return { model, figures: { taxWithheld: taxWithheld.centavos } }
}

export function buildReturn1601Q(
  ctx: ReturnContext,
  from: ISODate,
  to: ISODate,
  variant: 'EQ' | 'FQ',
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): BuiltReturn<Form1601EQ> {
  const kind = variant === 'EQ' ? 'expanded' : 'final'
  const total = withholdingForRange(txns, from, to, kind)
  const rows = atcSummary(txns, from, to, kind).map((r) => ({
    atc: r.atc,
    natureOfPayment:
      rules.atc(to, r.atc)?.natureOfPayment ??
      ctx.customAtcRates.find((c) => c.atc === r.atc)?.natureOfPayment ??
      r.atc,
    taxBase: r.base,
    taxWithheld: r.withheld,
  }))
  // Months 1-2 were remitted with 0619s; the quarterly return remits month 3.
  const start = periodOfDate(from)
  const monthly = sum([
    withholdingForMonth(txns, start.year, start.month, kind),
    withholdingForMonth(
      txns,
      start.month === 12 ? start.year + 1 : start.year,
      (start.month % 12) + 1,
      kind,
    ),
  ])
  const model: Form1601EQ = {
    header: header(`1601-${variant}`, ctx, from, to),
    rows,
    totalTaxWithheld: total,
    monthlyRemittances: monthly,
    netRemittance: total.subtract(monthly),
  }
  return {
    model,
    figures: { totalTaxWithheld: total.centavos, netRemittance: total.subtract(monthly).centavos },
  }
}

// ---------------- Compensation: 1601-C ----------------

interface PayrollLineComputation {
  employeeId: string
  gross: Money
  taxable: Money
  nonTaxable: Money
  withheld: Money
}

/** Recompute every payroll line in a window through the engine. */
export function payrollComputations(
  ctx: ReturnContext,
  from: ISODate,
  to: ISODate,
): PayrollLineComputation[] {
  const out: PayrollLineComputation[] = []
  for (const s of ctx.sheets) {
    if (s.status !== 'posted' || s.type !== 'payroll_register' || s.date < from || s.date > to) continue
    for (const l of s.lines) {
      const p = l.payroll
      const r = computePayrollWithholding(
        {
          frequency: s.payrollFrequency ?? 'monthly',
          basicPay: Money.fromCentavos(l.amountCentavos),
          otherTaxable: Money.fromCentavos(p?.otherTaxableCentavos ?? 0),
          thirteenthMonthAndOtherBenefits: Money.fromCentavos(p?.thirteenthMonthCentavos ?? 0),
          thirteenthMonthYtdBefore: Money.ZERO,
          deMinimis: [],
          mandatoryContributions: Money.fromCentavos(p?.mandatoryContributionsCentavos ?? 0),
        },
        s.date,
      )
      const deMinimis = Money.fromCentavos(p?.deMinimisCentavos ?? 0)
      out.push({
        employeeId: l.employeeId ?? l.description,
        gross: Money.fromCentavos(l.amountCentavos)
          .add(Money.fromCentavos(p?.otherTaxableCentavos ?? 0))
          .add(Money.fromCentavos(p?.thirteenthMonthCentavos ?? 0))
          .add(deMinimis),
        taxable: r.taxableCompensation,
        nonTaxable: r.nonTaxableCompensation.add(deMinimis),
        withheld: r.withholding,
      })
    }
  }
  return out
}

export function buildReturn1601C(ctx: ReturnContext, from: ISODate, to: ISODate): BuiltReturn<Form1601C> {
  const rows = payrollComputations(ctx, from, to)
  const total = sum(rows.map((r) => r.gross))
  const nonTaxable = sum(rows.map((r) => r.nonTaxable))
  const taxable = sum(rows.map((r) => r.taxable))
  const withheld = sum(rows.map((r) => r.withheld))
  const model: Form1601C = {
    header: header('1601-C', ctx, from, to),
    totalCompensation: total,
    nonTaxableCompensation: nonTaxable,
    taxableCompensation: taxable,
    taxWithheld: withheld,
    adjustments: Money.ZERO,
    totalRemittance: withheld,
  }
  return {
    model,
    figures: { totalCompensation: total.centavos, taxWithheld: withheld.centavos },
  }
}

// ---------------- Income tax ----------------

/** Ledger-derived income figures for a window. */
export function incomeFigures(ctx: ReturnContext, from: ISODate, to: ISODate) {
  let income = 0
  let costOfSales = 0
  let otherExpenses = 0
  const costCodes = new Set(
    ctx.accounts.filter((a) => a.systemRole === 'purchases').map((a) => a.code),
  )
  const typeOf = new Map(ctx.accounts.map((a) => [a.code, a.type]))
  for (const e of ctx.entries) {
    if (e.date < from || e.date > to) continue
    for (const l of e.lines) {
      const t = typeOf.get(l.accountCode)
      if (t === 'income') income += l.creditCentavos - l.debitCentavos
      else if (t === 'expense') {
        if (costCodes.has(l.accountCode)) costOfSales += l.debitCentavos - l.creditCentavos
        else otherExpenses += l.debitCentavos - l.creditCentavos
      }
    }
  }
  return {
    grossSalesReceipts: Money.fromCentavos(income),
    costOfSales: Money.fromCentavos(costOfSales),
    otherExpenses: Money.fromCentavos(otherExpenses),
    creditableWithheld: (() => {
      let c = 0
      const tagOf = new Map(ctx.accounts.map((a) => [a.code, a.taxTag]))
      for (const e of ctx.entries) {
        if (e.date < from || e.date > to) continue
        for (const l of e.lines) {
          if (tagOf.get(l.accountCode) === 'creditable_wtax_receivable') {
            c += l.debitCentavos - l.creditCentavos
          }
        }
      }
      return Money.fromCentavos(c)
    })(),
  }
}

const individualRegime = (ctx: ReturnContext) =>
  ctx.profile.incomeTaxRegime === 'eight_percent'
    ? ('eight_percent' as const)
    : ctx.profile.incomeTaxRegime === 'graduated_osd'
      ? ('graduated_osd' as const)
      : ctx.profile.incomeTaxRegime === 'exempt'
        ? ('exempt' as const)
        : ('graduated_itemized' as const)

export function buildReturn1701Q(
  ctx: ReturnContext,
  yearStart: ISODate,
  quarterEnd: ISODate,
): BuiltReturn<Form1701Q> {
  const f = incomeFigures(ctx, yearStart, quarterEnd)
  const regime = individualRegime(ctx)
  const prior = sumPriorFiguresInYear(ctx, '1701Q', yearStart, quarterEnd, 'netPayable')
  const r = computeIndividualQuarterlyTax(
    {
      regime,
      ytdGrossSalesReceipts: f.grossSalesReceipts,
      ytdCostOfSales: f.costOfSales,
      ytdItemizedDeductions: f.otherExpenses,
      ytdOtherTaxableIncome: Money.ZERO,
      taxableCompensationYtd: Money.ZERO,
      isMixedIncome: ctx.profile.entityType === 'mixed_income_individual',
      priorQuartersPayments: prior,
      creditableWithholdingYtd: f.creditableWithheld,
    },
    quarterEnd,
  )
  const deductions =
    regime === 'graduated_osd'
      ? f.grossSalesReceipts.multiply(rules.individualIncomeTax(quarterEnd).osdRate)
      : f.costOfSales.add(f.otherExpenses)
  const model: Form1701Q = {
    header: header('1701Q', ctx, yearStart, quarterEnd),
    method: regime === 'eight_percent' ? 'eight_percent' : 'graduated',
    grossReceipts: f.grossSalesReceipts,
    deductions: regime === 'eight_percent' ? Money.ZERO : deductions,
    taxableIncomeToDate: r.taxableIncomeYtd,
    taxDueToDate: r.taxDueYtd,
    priorQuartersPayments: prior,
    creditableWithheld: f.creditableWithheld,
    netPayable: r.netPayable,
  }
  return { model, figures: { taxDueToDate: r.taxDueYtd.centavos, netPayable: r.netPayable.centavos } }
}

export function buildReturn1701(ctx: ReturnContext, year: number): BuiltReturn<Form1701> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const f = incomeFigures(ctx, from, to)
  const regime = individualRegime(ctx)
  const result = computeIndividualIncomeTax(
    {
      regime,
      grossSalesReceipts: f.grossSalesReceipts,
      costOfSales: f.costOfSales,
      itemizedDeductions: f.otherExpenses,
      taxableCompensation: Money.ZERO,
      isMixedIncome: ctx.profile.entityType === 'mixed_income_individual',
      otherTaxableIncome: Money.ZERO,
    },
    to,
  )
  const quarterly = sumPriorFiguresInYear(ctx, '1701Q', from, to, 'netPayable')
  const credits = quarterly.add(f.creditableWithheld)
  const variant =
    ctx.profile.entityType !== 'mixed_income_individual' &&
    (regime === 'graduated_osd' || regime === 'eight_percent')
      ? '1701A'
      : '1701'
  const model: Form1701 = {
    header: header(variant, ctx, from, to),
    variant,
    method: result.method === 'eight_percent' ? 'eight_percent' : 'graduated',
    grossReceipts: f.grossSalesReceipts,
    costOfSales: f.costOfSales,
    deductions:
      regime === 'graduated_osd'
        ? f.grossSalesReceipts.multiply(rules.individualIncomeTax(to).osdRate)
        : regime === 'eight_percent'
          ? Money.ZERO
          : f.otherExpenses,
    taxableCompensation: Money.ZERO,
    taxableIncome: result.taxableIncome,
    taxDue: result.incomeTaxDue,
    creditsAndPayments: credits,
    netPayable: result.incomeTaxDue.subtract(credits),
  }
  return {
    model,
    figures: { taxDue: result.incomeTaxDue.centavos, netPayable: model.netPayable.centavos },
  }
}

const yearsSinceStart = (ctx: ReturnContext, asOf: ISODate): number => {
  if (!ctx.profile.startOfOperations) return 1
  return Math.max(1, periodOfDate(asOf).year - periodOfDate(ctx.profile.startOfOperations).year + 1)
}

const corporateRegime = (ctx: ReturnContext) =>
  ctx.profile.incomeTaxRegime === 'income_tax_holiday'
    ? ('income_tax_holiday' as const)
    : ctx.profile.incomeTaxRegime === 'special_rate_incentive'
      ? ('special_rate_incentive' as const)
      : ctx.profile.incomeTaxRegime === 'exempt'
        ? ('exempt' as const)
        : ('rcit' as const)

export function buildReturn1702Q(
  ctx: ReturnContext,
  fyStart: ISODate,
  quarterEnd: ISODate,
  overrides: { totalAssetsExclLandCentavos?: number } = {},
): BuiltReturn<Form1702Q> {
  const f = incomeFigures(ctx, fyStart, quarterEnd)
  const net = f.grossSalesReceipts.subtract(f.costOfSales).subtract(f.otherExpenses)
  const grossIncome = f.grossSalesReceipts.subtract(f.costOfSales)
  const prior = sumPriorFiguresInYear(ctx, '1702Q', fyStart, quarterEnd, 'netPayable')
  const r = computeCorporateQuarterlyTax(
    {
      regime: corporateRegime(ctx),
      ytdNetTaxableIncome: net,
      ytdGrossIncome: grossIncome,
      totalAssetsExclLand: Money.fromCentavos(overrides.totalAssetsExclLandCentavos ?? 0),
      yearsSinceStartOfOperations: yearsSinceStart(ctx, quarterEnd),
      isDomestic: ctx.profile.entityType !== 'resident_foreign_corporation' && ctx.profile.entityType !== 'branch_office',
      priorQuartersPayments: prior,
      creditableWithholdingYtd: f.creditableWithheld,
    },
    quarterEnd,
  )
  const model: Form1702Q = {
    header: header('1702Q', ctx, fyStart, quarterEnd),
    grossIncome,
    deductions: f.otherExpenses,
    taxableIncomeToDate: net,
    rcit: r.rcit,
    mcit: r.mcit,
    taxDueToDate: r.taxDueYtd,
    priorQuartersPayments: prior,
    creditableWithheld: f.creditableWithheld,
    netPayable: r.netPayable,
  }
  return { model, figures: { taxDueToDate: r.taxDueYtd.centavos, netPayable: r.netPayable.centavos } }
}

export function buildReturn1702(
  ctx: ReturnContext,
  fyStart: ISODate,
  fyEnd: ISODate,
  overrides: { totalAssetsExclLandCentavos?: number } = {},
): BuiltReturn<Form1702> {
  const f = incomeFigures(ctx, fyStart, fyEnd)
  const net = f.grossSalesReceipts.subtract(f.costOfSales).subtract(f.otherExpenses)
  const grossIncome = f.grossSalesReceipts.subtract(f.costOfSales)
  const regime = corporateRegime(ctx)
  const r = computeCorporateIncomeTax(
    {
      regime,
      netTaxableIncome: net,
      grossIncome,
      totalAssetsExclLand: Money.fromCentavos(overrides.totalAssetsExclLandCentavos ?? 0),
      yearsSinceStartOfOperations: yearsSinceStart(ctx, fyEnd),
      isDomestic: ctx.profile.entityType !== 'resident_foreign_corporation' && ctx.profile.entityType !== 'branch_office',
    },
    fyEnd,
  )
  const quarterly = sumPriorFiguresInYear(ctx, '1702Q', fyStart, fyEnd, 'netPayable')
  const credits = quarterly.add(f.creditableWithheld)
  const variant =
    regime === 'exempt' || regime === 'income_tax_holiday'
      ? 'EX'
      : regime === 'special_rate_incentive' || ctx.profile.incentive
        ? 'MX'
        : 'RT'
  const model: Form1702 = {
    header: header(`1702-${variant}`, ctx, fyStart, fyEnd),
    variant,
    grossIncome,
    deductions: f.otherExpenses,
    taxableIncome: net,
    rcit: r.rcit,
    mcit: r.mcit,
    incentiveRateTax: regime === 'special_rate_incentive' ? r.incomeTaxDue : Money.ZERO,
    taxDue: r.incomeTaxDue,
    creditsAndPayments: credits,
    netPayable: r.incomeTaxDue.subtract(credits),
  }
  return { model, figures: { taxDue: r.incomeTaxDue.centavos, netPayable: model.netPayable.centavos } }
}

// ---------------- Annual information returns (1604 series) ----------------

export function buildReturn1604(
  ctx: ReturnContext,
  year: number,
  variant: 'C' | 'E' | 'F',
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): BuiltReturn<Form1604> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  let rows: Form1604['rows']
  if (variant === 'C') {
    const byEmployee = new Map<string, { base: number; withheld: number }>()
    for (const r of payrollComputations(ctx, from, to)) {
      const acc = byEmployee.get(r.employeeId) ?? { base: 0, withheld: 0 }
      acc.base += r.taxable.centavos
      acc.withheld += r.withheld.centavos
      byEmployee.set(r.employeeId, acc)
    }
    rows = [...byEmployee.entries()].map(([employeeId, r], i) => {
      const emp = ctx.employees.find((e) => e.id === employeeId)
      return {
        seq: i + 1,
        tin: emp?.tin ?? { base: '000000000', branchCode: '000' },
        name: emp ? `${emp.lastName}, ${emp.firstName}` : employeeId,
        atc: 'WW010',
        taxBase: Money.fromCentavos(r.base),
        ratePercent: 0,
        taxWithheld: Money.fromCentavos(r.withheld),
      }
    })
  } else {
    const kind = variant === 'E' ? 'expanded' : 'final'
    rows = qapEntries(txns, from, to, kind).map((r, i) => {
      const party = ctx.parties.find((p) => p.id === r.payeeId)
      const rate = rules.atc(to, r.atc) ?? ctx.customAtcRates.find((c) => c.atc === r.atc)
      return {
        seq: i + 1,
        tin: party?.tin ?? { base: '000000000', branchCode: '000' },
        name: party?.registeredName ?? r.payeeId,
        atc: r.atc,
        taxBase: r.base,
        ratePercent: rate ? (rate.rate.num / rate.rate.den) * 100 : 0,
        taxWithheld: r.withheld,
      }
    })
  }
  const model: Form1604 = {
    header: header(`1604-${variant}`, ctx, from, to),
    variant,
    rows,
    totalBase: sum(rows.map((r) => r.taxBase)),
    totalWithheld: sum(rows.map((r) => r.taxWithheld)),
  }
  return { model, figures: { totalWithheld: model.totalWithheld.centavos } }
}

// ---------------- Attachments ----------------

export function buildSlsp(ctx: ReturnContext, from: ISODate, to: ISODate): SlspModel {
  const aggregate = (
    docs: ReturnType<typeof saleDocuments>,
  ): SlspRow[] => {
    const byParty = new Map<string, { party: (typeof docs)[number]['party']; gross: number; exempt: number; zero: number; net: number; vat: number }>()
    for (const d of docs) {
      const key = d.party?.id ?? '—'
      const acc = byParty.get(key) ?? { party: d.party, gross: 0, exempt: 0, zero: 0, net: 0, vat: 0 }
      acc.gross += d.sign * d.totals.gross.centavos
      acc.exempt += d.sign * d.totals.exemptNet.centavos
      acc.zero += d.sign * d.totals.zeroRatedNet.centavos
      acc.net += d.sign * d.totals.vatableNet.centavos
      acc.vat += d.sign * d.totals.vat.centavos
      byParty.set(key, acc)
    }
    return [...byParty.values()].map((a) => ({
      counterpartyTin: a.party?.tin ?? { base: '000000000', branchCode: '000' },
      registeredName: a.party?.registeredName ?? 'VARIOUS',
      address: a.party?.registeredAddress ?? '',
      grossAmount: Money.fromCentavos(a.gross),
      exemptAmount: Money.fromCentavos(a.exempt),
      zeroRatedAmount: Money.fromCentavos(a.zero),
      taxableNet: Money.fromCentavos(a.net),
      vatAmount: Money.fromCentavos(a.vat),
    }))
  }
  return {
    ownerTin: ctx.company.tin,
    ownerName: ctx.company.registeredName,
    periodFrom: from,
    periodTo: to,
    sales: aggregate(saleDocuments(ctx, from, to)),
    purchases: aggregate(purchaseDocuments(ctx, from, to)),
  }
}

export function buildQap(
  ctx: ReturnContext,
  from: ISODate,
  to: ISODate,
  kind: 'EQ' | 'FQ',
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): QapModel {
  const rows = qapEntries(txns, from, to, kind === 'EQ' ? 'expanded' : 'final').map((r) => {
    const party = ctx.parties.find((p) => p.id === r.payeeId)
    const rate = rules.atc(to, r.atc) ?? ctx.customAtcRates.find((c) => c.atc === r.atc)
    return {
      payeeTin: party?.tin ?? { base: '000000000', branchCode: '000' },
      payeeName: party?.registeredName ?? r.payeeId,
      atc: r.atc,
      incomePayment: r.base,
      ratePercent: rate ? (rate.rate.num / rate.rate.den) * 100 : 0,
      taxWithheld: r.withheld,
    }
  })
  return { agentTin: ctx.company.tin, agentName: ctx.company.registeredName, quarterEnd: to, kind, rows }
}

export function buildSawt(
  ctx: ReturnContext,
  from: ISODate,
  to: ISODate,
  attachedToForm: string,
): SawtModel {
  // Creditable tax withheld FROM us: sale documents where the customer withheld.
  const rows = saleDocuments(ctx, from, to)
    .filter((d) => !d.totals.withholdingTotal.isZero() || !d.totals.governmentVatWithheld.isZero())
    .map((d) => ({
      payorTin: d.party?.tin ?? { base: '000000000', branchCode: '000' },
      payorName: d.party?.registeredName ?? 'VARIOUS',
      atc: d.sheet.lines.find((l) => l.atc)?.atc ?? '',
      incomePayment: d.totals.net,
      taxWithheld: d.totals.withholdingTotal.add(d.totals.governmentVatWithheld),
    }))
  return {
    claimantTin: ctx.company.tin,
    claimantName: ctx.company.registeredName,
    returnPeriodEnd: to,
    attachedToForm,
    rows,
  }
}

export function buildAnnualAlphalist(
  ctx: ReturnContext,
  year: number,
  variant: 'C' | 'E' | 'F',
): AnnualAlphalistModel {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const employees: AnnualAlphalistModel['employees'][number][] = []
  if (variant === 'C') {
    const byEmployee = new Map<string, { gross: number; nonTax: number; taxable: number; withheld: number }>()
    for (const r of payrollComputations(ctx, from, to)) {
      const acc = byEmployee.get(r.employeeId) ?? { gross: 0, nonTax: 0, taxable: 0, withheld: 0 }
      acc.gross += r.gross.centavos
      acc.nonTax += r.nonTaxable.centavos
      acc.taxable += r.taxable.centavos
      acc.withheld += r.withheld.centavos
      byEmployee.set(r.employeeId, acc)
    }
    for (const [employeeId, r] of byEmployee) {
      const emp = ctx.employees.find((e) => e.id === employeeId)
      employees.push({
        tin: emp?.tin ?? { base: '000000000', branchCode: '000' },
        lastName: emp?.lastName ?? employeeId,
        firstName: emp?.firstName ?? '',
        middleName: emp?.middleName ?? '',
        grossCompensation: Money.fromCentavos(r.gross),
        nonTaxable: Money.fromCentavos(r.nonTax),
        taxable: Money.fromCentavos(r.taxable),
        taxWithheld: Money.fromCentavos(r.withheld),
        employedFrom: emp?.hireDate ?? from,
        employedTo: emp?.separationDate ?? null,
      })
    }
  }
  return {
    agentTin: ctx.company.tin,
    agentName: ctx.company.registeredName,
    year,
    variant,
    employees,
  }
}

// ---------------- Certificates ----------------

const companyAsParty = (ctx: ReturnContext): CertificateParty => ({
  tin: ctx.company.tin,
  registeredName: ctx.company.registeredName,
  address: ctx.company.registeredAddress,
  zipCode: ctx.company.zipCode ?? '',
})

const partyAsCertParty = (ctx: ReturnContext, partyId: string): CertificateParty => {
  const p = ctx.parties.find((x) => x.id === partyId)
  return {
    tin: p?.tin ?? { base: '000000000', branchCode: '000' },
    registeredName: p?.registeredName ?? partyId,
    address: p?.registeredAddress ?? '',
    zipCode: p?.zipCode ?? '',
  }
}

/** 2307 per payee for the calendar quarter starting at quarterStart. */
export function build2307Certificates(
  ctx: ReturnContext,
  quarterStart: { year: number; month: number },
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): Form2307[] {
  const data = certificateData(txns, quarterStart, 'expanded')
  const from = `${quarterStart.year}-${String(quarterStart.month).padStart(2, '0')}-01`
  const endMonth = quarterStart.month + 2
  const to = `${quarterStart.year}-${String(endMonth).padStart(2, '0')}-${new Date(Date.UTC(quarterStart.year, endMonth, 0)).getUTCDate()}`
  return data.map((d) => ({
    periodFrom: from,
    periodTo: to,
    payor: companyAsParty(ctx),
    payee: partyAsCertParty(ctx, d.payeeId),
    rows: d.rows.map((r) => ({
      atc: r.atc,
      natureOfPayment:
        rules.atc(to, r.atc)?.natureOfPayment ??
        ctx.customAtcRates.find((c) => c.atc === r.atc)?.natureOfPayment ??
        r.atc,
      monthAmounts: r.monthAmounts,
      total: r.total,
      taxWithheld: r.taxWithheld,
    })),
    totalBase: d.totalBase,
    totalWithheld: d.totalWithheld,
  }))
}

/** 2306 per payee (final withholding) for the quarter. */
export function build2306Certificates(
  ctx: ReturnContext,
  quarterStart: { year: number; month: number },
  txns: readonly WithholdingTxn[] = collectWithholdingTxns(ctx),
): Form2306[] {
  const data = certificateData(txns, quarterStart, 'final')
  const from = `${quarterStart.year}-${String(quarterStart.month).padStart(2, '0')}-01`
  const endMonth = quarterStart.month + 2
  const to = `${quarterStart.year}-${String(endMonth).padStart(2, '0')}-${new Date(Date.UTC(quarterStart.year, endMonth, 0)).getUTCDate()}`
  return data.flatMap((d) =>
    d.rows.map((r) => ({
      periodFrom: from,
      periodTo: to,
      payor: companyAsParty(ctx),
      payee: partyAsCertParty(ctx, d.payeeId),
      atc: r.atc,
      natureOfIncome:
        rules.atc(to, r.atc)?.natureOfPayment ??
        ctx.customAtcRates.find((c) => c.atc === r.atc)?.natureOfPayment ??
        r.atc,
      incomePayment: r.total,
      finalTaxWithheld: r.taxWithheld,
    })),
  )
}

/** 2316 per employee for a calendar year, with the annualized true-up. */
export function build2316Certificates(ctx: ReturnContext, year: number): Form2316[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const byEmployee = new Map<string, { gross: number; nonTax: number; taxable: number; withheld: number }>()
  for (const r of payrollComputations(ctx, from, to)) {
    const acc = byEmployee.get(r.employeeId) ?? { gross: 0, nonTax: 0, taxable: 0, withheld: 0 }
    acc.gross += r.gross.centavos
    acc.nonTax += r.nonTaxable.centavos
    acc.taxable += r.taxable.centavos
    acc.withheld += r.withheld.centavos
    byEmployee.set(r.employeeId, acc)
  }
  return [...byEmployee.entries()].map(([employeeId, r]) => {
    const emp = ctx.employees.find((e) => e.id === employeeId)
    const { annualTaxDue } = annualizeYearEnd(
      { taxableCompensationYtd: Money.fromCentavos(r.taxable), withheldBeforeFinalRun: Money.ZERO },
      to,
    )
    return {
      year,
      employer: companyAsParty(ctx),
      employee: {
        tin: emp?.tin ?? { base: '000000000', branchCode: '000' },
        registeredName: emp ? `${emp.lastName}, ${emp.firstName}` : employeeId,
        address: emp?.registeredAddress ?? '',
        zipCode: '',
        employeeNo: emp?.employeeNo ?? '',
        position: '',
      },
      compensationFrom: emp?.hireDate && emp.hireDate > from ? emp.hireDate : from,
      compensationTo: to,
      grossCompensation: Money.fromCentavos(r.gross),
      nonTaxable13thMonth: Money.ZERO,
      nonTaxableDeMinimis: Money.fromCentavos(r.nonTax),
      statutoryContributions: Money.ZERO,
      taxableCompensation: Money.fromCentavos(r.taxable),
      taxDue: annualTaxDue,
      taxWithheld: Money.fromCentavos(r.withheld),
      substitutedFiling: annualTaxDue.centavos === r.withheld,
    }
  })
}

export const formatTin = formatTIN

export const isIndividualProfile = (ctx: ReturnContext) => isIndividualType(ctx.profile.entityType)
