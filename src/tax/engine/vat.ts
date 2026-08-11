import type { ISODate } from '../../domain/core'
import { Money, rate, sum } from '../../lib/money'
import { rules } from '../rules'

/**
 * Per-line VAT classification. One document may mix all three — a hospital
 * bill with vatable supplies and exempt professional services, an exporter
 * invoice with zero-rated and vatable lines.
 */
export type VatClass = 'vatable' | 'exempt' | 'zero_rated'

export interface VatBreakdown {
  /** VAT-inclusive total. */
  readonly gross: Money
  /** VAT-exclusive base. */
  readonly net: Money
  readonly vat: Money
  readonly vatClass: VatClass
}

/**
 * Derive net + VAT from an entered amount. `inclusive` mirrors how PH
 * invoices are usually priced (gross, VAT inside); when false the amount is
 * the net base and VAT is added on top.
 */
export function deriveVat(
  amount: Money,
  vatClass: VatClass,
  inclusive: boolean,
  date: ISODate,
): VatBreakdown {
  if (vatClass !== 'vatable') {
    // Exempt and zero-rated lines carry no VAT; the distinction still matters
    // for returns (different 2550Q lines) and input-VAT allocation.
    return { gross: amount, net: amount, vat: Money.ZERO, vatClass }
  }
  const std = rules.vat(date).standardRate
  if (inclusive) {
    // net = gross × den/(den+num), rounded half-up once at the end.
    const net = amount.multiply(rate(std.den, std.den + std.num))
    return { gross: amount, net, vat: amount.subtract(net), vatClass }
  }
  const vat = amount.multiply(std)
  return { gross: amount.add(vat), net: amount, vat, vatClass }
}

export interface InputVatAllocation {
  /** Creditable against output VAT (attributable to vatable sales). */
  readonly creditable: Money
  /** Attributable to zero-rated sales: creditable, or refundable under Sec. 112. */
  readonly attributableToZeroRated: Money
  /** Attributable to exempt sales: not creditable, closed to cost/expense. */
  readonly expensed: Money
}

/**
 * Sec. 110(A)(3) pro-rata allocation of input VAT that cannot be directly
 * attributed, for mixed-transaction taxpayers: split by the sales mix of the
 * period. Uses largest-remainder allocation so not a centavo is lost.
 */
export function allocateInputVat(
  inputVat: Money,
  sales: { vatable: Money; zeroRated: Money; exempt: Money },
): InputVatAllocation {
  const total = sum([sales.vatable, sales.zeroRated, sales.exempt])
  if (total.isZero()) {
    // No sales in the period: park everything as creditable carry-over.
    return { creditable: inputVat, attributableToZeroRated: Money.ZERO, expensed: Money.ZERO }
  }
  const [creditable, zeroRated, exempt] = inputVat.allocate([
    sales.vatable.centavos,
    sales.zeroRated.centavos,
    sales.exempt.centavos,
  ])
  return {
    creditable: creditable!,
    attributableToZeroRated: zeroRated!,
    expensed: exempt!,
  }
}

/** 5% final/creditable VAT withheld by government payors on their purchases. */
export function governmentVatWithholding(netBase: Money, date: ISODate): Money {
  return netBase.multiply(rules.vat(date).governmentWithholdingRate)
}
