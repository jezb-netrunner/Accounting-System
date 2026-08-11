import type { Company } from '../../data/ports'
import type { Account } from '../../domain/coa'
import type { ISODate } from '../../domain/core'
import type { JournalEntry } from '../../domain/journal'
import type { Employee, Party } from '../../domain/masterData'
import { isPurchaseSheet, isSaleSheet, type Sheet } from '../../domain/sheets'
import type { TaxProfile } from '../../domain/taxProfile'
import { Money } from '../../lib/money'
import { deriveDocumentTotals, deriveLineTax } from '../../tax/engine/lineTax'
import type { WithholdingTxn } from '../../tax/engine/withholdingPeriod'
import type { AtcRateRule } from '../../tax/rules/withholding'

/**
 * Everything a return builder may need, assembled once by the UI. Builders
 * stay pure: they read this context and a period window, never storage.
 */

export interface GeneratedReturn {
  readonly id: string // `${companyId}:${formCode}:${periodTo}`
  readonly companyId: string
  readonly formCode: string
  readonly periodFrom: ISODate
  readonly periodTo: ISODate
  readonly generatedAt: string
  /** Key figures snapshot (centavos) for carry-forward and close checks. */
  readonly figures: Readonly<Record<string, number>>
}

export interface ReturnContext {
  readonly company: Company
  readonly profile: TaxProfile
  readonly entries: readonly JournalEntry[]
  readonly sheets: readonly Sheet[]
  readonly parties: readonly Party[]
  readonly employees: readonly Employee[]
  readonly accounts: readonly Account[]
  readonly customAtcRates: readonly AtcRateRule[]
  /** Previously generated returns — the carry-forward store. */
  readonly priorReturns: readonly GeneratedReturn[]
}

const partyOf = (ctx: ReturnContext, id: string | null) =>
  ctx.parties.find((p) => p.id === id) ?? null

const docTaxContext = (ctx: ReturnContext, sheet: Sheet) => {
  const party = partyOf(ctx, sheet.partyId)
  return {
    profile: ctx.profile,
    direction: (isSaleSheet(sheet.type) ? 'sale' : 'purchase') as 'sale' | 'purchase',
    date: sheet.date,
    counterpartyClass: party?.payeeClass ?? ('corporation' as const),
    counterpartyIsGovernment: party?.isGovernment ?? false,
    customAtcRates: ctx.customAtcRates,
  }
}

/**
 * Withholding transactions (payee-level detail) from posted sheets — the
 * source for QAP rows, 1601-EQ/FQ schedules, 2307/2306 certificates, and
 * the 1604-E/F alphalists. Ledger tags only carry aggregates; the payee and
 * ATC detail lives on the source documents.
 */
export function collectWithholdingTxns(ctx: ReturnContext): WithholdingTxn[] {
  const out: WithholdingTxn[] = []
  for (const sheet of ctx.sheets) {
    if (sheet.status !== 'posted') continue
    const isAgentDoc = isPurchaseSheet(sheet.type) || sheet.type === 'disbursement'
    if (!isAgentDoc) continue
    if (!ctx.profile.withholdingAgent.expanded && !ctx.profile.withholdingAgent.final) continue
    const taxCtx = docTaxContext(ctx, sheet)
    for (const line of sheet.lines) {
      if (!line.atc) continue
      const d = deriveLineTax(taxCtx, {
        amount: Money.fromCentavos(line.amountCentavos),
        amountIsVatInclusive: line.amountIsVatInclusive,
        vatClass: line.vatClass,
        atc: line.atc,
      })
      if (!d.withholding || d.withholding.amount.isZero()) continue
      out.push({
        date: sheet.date,
        payeeId: sheet.partyId ?? 'unknown',
        atc: line.atc,
        base: d.withholding.base,
        amount: d.withholding.amount,
        kind: d.withholding.kind,
      })
    }
  }
  return out
}

/** Posted sale documents in a window with their engine-derived totals. */
export function saleDocuments(ctx: ReturnContext, from: ISODate, to: ISODate) {
  return ctx.sheets
    .filter((s) => s.status === 'posted' && isSaleSheet(s.type) && s.date >= from && s.date <= to)
    .map((sheet) => {
      const sign = sheet.type === 'credit_memo' ? -1 : 1
      const { totals } = deriveDocumentTotals(
        docTaxContext(ctx, sheet),
        sheet.lines.map((l) => ({
          amount: Money.fromCentavos(l.amountCentavos),
          amountIsVatInclusive: l.amountIsVatInclusive,
          vatClass: l.vatClass,
          atc: l.atc,
        })),
      )
      return { sheet, party: partyOf(ctx, sheet.partyId), totals, sign }
    })
}

/** Posted purchase documents in a window with their engine-derived totals. */
export function purchaseDocuments(ctx: ReturnContext, from: ISODate, to: ISODate) {
  return ctx.sheets
    .filter((s) => s.status === 'posted' && isPurchaseSheet(s.type) && s.date >= from && s.date <= to)
    .map((sheet) => {
      const sign = sheet.type === 'debit_memo' ? -1 : 1
      const { totals } = deriveDocumentTotals(
        docTaxContext(ctx, sheet),
        sheet.lines.map((l) => ({
          amount: Money.fromCentavos(l.amountCentavos),
          amountIsVatInclusive: l.amountIsVatInclusive,
          vatClass: l.vatClass,
          atc: l.atc,
        })),
      )
      return { sheet, party: partyOf(ctx, sheet.partyId), totals, sign }
    })
}

/** Cash actually received in a window (cash-basis gross receipts). */
export function cashReceipts(ctx: ReturnContext, from: ISODate, to: ISODate): Money {
  let acc = Money.ZERO
  for (const s of ctx.sheets) {
    if (s.status !== 'posted' || s.date < from || s.date > to) continue
    if (s.type === 'collection') {
      acc = s.lines.reduce((a, l) => a.add(Money.fromCentavos(l.amountCentavos)), acc)
    } else if (s.type === 'sales_receipt') {
      const { totals } = deriveDocumentTotals(
        docTaxContext(ctx, s),
        s.lines.map((l) => ({
          amount: Money.fromCentavos(l.amountCentavos),
          amountIsVatInclusive: l.amountIsVatInclusive,
          vatClass: l.vatClass,
          atc: l.atc,
        })),
      )
      acc = acc.add(totals.net)
    }
  }
  return acc
}

/** Prior generated figure lookup (e.g. last quarter's excess input VAT). */
export function priorFigure(
  ctx: ReturnContext,
  formCode: string,
  before: ISODate,
  key: string,
): Money {
  const prior = ctx.priorReturns
    .filter((r) => r.formCode === formCode && r.periodTo < before)
    .sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0]
  return Money.fromCentavos(prior?.figures[key] ?? 0)
}

/** Sum a figure across this fiscal year's earlier returns of a form (quarterly payments). */
export function sumPriorFiguresInYear(
  ctx: ReturnContext,
  formCode: string,
  yearStart: ISODate,
  before: ISODate,
  key: string,
): Money {
  return ctx.priorReturns
    .filter((r) => r.formCode === formCode && r.periodTo >= yearStart && r.periodTo < before)
    .reduce((acc, r) => {
      const v = r.figures[key] ?? 0
      return v > 0 ? acc.add(Money.fromCentavos(v)) : acc
    }, Money.ZERO)
}
