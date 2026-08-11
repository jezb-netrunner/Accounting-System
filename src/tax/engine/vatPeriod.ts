import { addMonths, periodOfDate, periodStart, type ISODate, type Period } from '../../domain/core'
import { Money, sum } from '../../lib/money'
import { rules } from '../rules'

/**
 * Quarterly VAT computation (2550Q core), pure functions over injected
 * figures. Sec. 110(A)(3) allocation for mixed transactions, Sec. 110(A)
 * capital-goods amortization (with the CREATE sunset resolved from the rule
 * table), and the carry-forward of excess input VAT all live here.
 */

export interface VatPeriodInput {
  readonly outputVat: Money
  /** Input VAT directly attributable to vatable and zero-rated sales — fully creditable. */
  readonly inputVatDirectTaxable: Money
  /** Input VAT directly attributable to exempt sales — never creditable, closed to cost. */
  readonly inputVatDirectExempt: Money
  /** Input VAT that cannot be attributed — allocated by the period's sales mix. */
  readonly inputVatCommon: Money
  /** This period's slice of running capital-goods amortization schedules. */
  readonly amortizedInputVatThisPeriod: Money
  readonly sales: {
    readonly vatable: Money
    readonly zeroRated: Money
    readonly exempt: Money
  }
  /** Prior quarter's excess input VAT (2550Q line "carried over from previous period"). */
  readonly excessInputVatCarriedForward: Money
  /** 5% VAT withheld by government payors on their purchases from us (creditable). */
  readonly vatWithheldByGovernment: Money
}

export interface VatPeriodResult {
  readonly commonAllocatedToTaxable: Money
  readonly commonAllocatedToExempt: Money
  /** Direct taxable + allocated common + amortized capital goods. */
  readonly creditableInputVat: Money
  /** Direct exempt + common allocated to exempt: book to cost/expense. */
  readonly inputVatExpensed: Money
  /** Creditable input VAT + carry-forward + VAT withheld by government. */
  readonly totalAvailableCredits: Money
  readonly netVatPayable: Money
  /** Excess credits carry to the next quarter — never lost. */
  readonly excessInputVatCarryForward: Money
}

export function computeVatPeriod(input: VatPeriodInput): VatPeriodResult {
  const taxableSales = input.sales.vatable.add(input.sales.zeroRated)
  const totalSales = taxableSales.add(input.sales.exempt)

  let commonToTaxable: Money
  let commonToExempt: Money
  if (totalSales.isZero()) {
    // No sales in the period: nothing to allocate against, so the common
    // input VAT stays creditable (it will meet sales in a later quarter).
    commonToTaxable = input.inputVatCommon
    commonToExempt = Money.ZERO
  } else {
    const [toTaxable, toExempt] = input.inputVatCommon.allocate([
      taxableSales.centavos,
      input.sales.exempt.centavos,
    ])
    commonToTaxable = toTaxable!
    commonToExempt = toExempt!
  }

  const creditableInputVat = sum([
    input.inputVatDirectTaxable,
    commonToTaxable,
    input.amortizedInputVatThisPeriod,
  ])
  const totalAvailableCredits = sum([
    creditableInputVat,
    input.excessInputVatCarriedForward,
    input.vatWithheldByGovernment,
  ])
  const net = input.outputVat.subtract(totalAvailableCredits)

  return {
    commonAllocatedToTaxable: commonToTaxable,
    commonAllocatedToExempt: commonToExempt,
    creditableInputVat,
    inputVatExpensed: input.inputVatDirectExempt.add(commonToExempt),
    totalAvailableCredits,
    netVatPayable: net.isNegative() ? Money.ZERO : net,
    excessInputVatCarryForward: net.isNegative() ? net.negate() : Money.ZERO,
  }
}

// ---- Capital goods (Sec. 110(A), CREATE sunset) ----

export interface CapitalGoodsAcquisition {
  readonly acquisitionDate: ISODate
  readonly inputVat: Money
  readonly usefulLifeMonths: number
  /** Aggregate acquisition cost (net of VAT) of capital goods for the calendar month. */
  readonly monthlyAggregateAcquisitionCost: Money
}

export interface AmortizationSchedule {
  readonly amortized: boolean
  /** Month of acquisition = first month a slice is claimable. */
  readonly startPeriod: Period
  readonly months: number
  /** One slice per month; sums exactly to the input VAT (largest remainder). */
  readonly monthlyAmounts: readonly Money[]
}

/**
 * Build the claim schedule for one capital-goods acquisition. Acquisitions
 * after the rule table's amortization sunset (or below the monthly aggregate
 * threshold, or under an era with no amortization regime) are claimed in
 * full in the month of purchase; everything else spreads over
 * min(useful life, cap) months. Running pre-sunset schedules keep going —
 * that is exactly why this derives from the acquisition date, not "today".
 */
export function buildCapitalGoodsSchedule(acq: CapitalGoodsAcquisition): AmortizationSchedule {
  const rule = rules.vat(acq.acquisitionDate).capitalGoods
  const startPeriod = periodOfDate(acq.acquisitionDate)
  const mustAmortize =
    rule !== null &&
    (rule.amortizationSunset === null || acq.acquisitionDate <= rule.amortizationSunset) &&
    acq.monthlyAggregateAcquisitionCost.centavos > rule.monthlyAggregateThresholdCentavos

  if (!mustAmortize) {
    return { amortized: false, startPeriod, months: 1, monthlyAmounts: [acq.inputVat] }
  }
  const months = Math.min(acq.usefulLifeMonths, rule.maxAmortizationMonths)
  return {
    amortized: true,
    startPeriod,
    months,
    monthlyAmounts: acq.inputVat.allocate(Array.from({ length: months }, () => 1)),
  }
}

/** Sum of schedule slices for months falling inside [from, to] (month granularity). */
export function amortizedInputVatForWindow(
  schedules: readonly AmortizationSchedule[],
  from: ISODate,
  to: ISODate,
): Money {
  const fromKey = from.slice(0, 7)
  const toKey = to.slice(0, 7)
  let acc = Money.ZERO
  for (const s of schedules) {
    for (let i = 0; i < s.months; i++) {
      const key = periodStart(addMonths(s.startPeriod, i)).slice(0, 7)
      if (key >= fromKey && key <= toKey) acc = acc.add(s.monthlyAmounts[i]!)
    }
  }
  return acc
}
