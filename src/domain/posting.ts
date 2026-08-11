import { Money, sum } from '../lib/money'
import { deriveDocumentTotals, type DocumentTaxContext } from '../tax/engine/lineTax'
import { computePayrollWithholding } from '../tax/engine/withholdingPeriod'
import type { Account, SystemRole, TaxTag } from './coa'
import type { JournalEntryId } from './core'
import { createJournalEntry, type JournalEntry, type JournalLineInput } from './journal'
import type { Party } from './masterData'
import { isPurchaseSheet, isSaleSheet, type Sheet } from './sheets'
import type { TaxProfile } from './taxProfile'

/**
 * Posting: the only path from a sheet to the ledger. One posted sheet
 * produces one balanced journal entry; the invariant lives in
 * createJournalEntry, so nothing unbalanced can ever reach storage.
 */

export class PostingError extends Error {}

export interface AccountsIndex {
  byCode(code: string): Account
  byTag(tag: TaxTag): Account
  byRole(role: SystemRole): Account
}

export function indexAccounts(accounts: readonly Account[]): AccountsIndex {
  const byCode = new Map(accounts.map((a) => [a.code, a]))
  const byTag = new Map<TaxTag, Account>()
  const byRole = new Map<SystemRole, Account>()
  for (const a of accounts) {
    if (a.taxTag !== 'none' && !byTag.has(a.taxTag)) byTag.set(a.taxTag, a)
    if (a.systemRole && !byRole.has(a.systemRole)) byRole.set(a.systemRole, a)
  }
  return {
    byCode(code) {
      const a = byCode.get(code)
      if (!a) throw new PostingError(`No account with code ${code}`)
      if (!a.postable) throw new PostingError(`Account ${code} ${a.name} is not postable`)
      return a
    },
    byTag(tag) {
      const a = byTag.get(tag)
      if (!a) throw new PostingError(`Chart of accounts has no account tagged "${tag}"`)
      return a
    },
    byRole(role) {
      const a = byRole.get(role)
      if (!a) throw new PostingError(`Chart of accounts has no account with role "${role}"`)
      return a
    },
  }
}

export interface PostingContext {
  readonly profile: TaxProfile
  readonly accounts: AccountsIndex
  readonly party: Party | null
  readonly entryId: JournalEntryId
  readonly entryNo: number
  readonly postedAt: string
  /** Item id → income/expense account code, for lines priced off items. */
  readonly itemAccountCodes?: ReadonlyMap<string, { income: string; expense: string | null }>
  /** Company ATC master data rows beyond the built-in matrix. */
  readonly customAtcRates?: readonly import('../tax/rules/withholding').AtcRateRule[]
}

const salesTagFor = (vatClass: 'vatable' | 'exempt' | 'zero_rated' | null): TaxTag =>
  vatClass === 'exempt' ? 'sales_exempt' : vatClass === 'zero_rated' ? 'sales_zero_rated' : 'sales_vatable'

/** Tax-engine context for a sheet, derived from profile + party. */
const taxContextFor = (sheet: Sheet, ctx: PostingContext): DocumentTaxContext => ({
  profile: ctx.profile,
  direction: isSaleSheet(sheet.type) ? 'sale' : 'purchase',
  date: sheet.date,
  counterpartyClass: ctx.party?.payeeClass ?? 'corporation',
  counterpartyIsGovernment: ctx.party?.isGovernment ?? false,
  customAtcRates: ctx.customAtcRates,
})

export function postSheet(sheet: Sheet, ctx: PostingContext): JournalEntry {
  if (sheet.status !== 'draft') {
    throw new PostingError(`Only draft sheets can be posted; this one is ${sheet.status}`)
  }
  if (sheet.lines.length === 0) throw new PostingError('Cannot post an empty sheet')

  const lines = buildLines(sheet, ctx)
  return createJournalEntry({
    id: ctx.entryId,
    companyId: sheet.companyId,
    entryNo: ctx.entryNo,
    date: sheet.date,
    description: `${sheet.type.replace(/_/g, ' ')} ${sheet.documentNo}${ctx.party ? ` — ${ctx.party.registeredName}` : ''}`,
    sheetId: sheet.id,
    postedAt: ctx.postedAt,
    lines,
  })
}

function buildLines(sheet: Sheet, ctx: PostingContext): JournalLineInput[] {
  switch (sheet.type) {
    case 'sales_invoice':
    case 'sales_receipt':
    case 'credit_memo':
      return saleLines(sheet, ctx)
    case 'purchase_bill':
    case 'debit_memo':
      return purchaseLines(sheet, ctx)
    case 'collection':
      return settlementLines(sheet, ctx, 'accounts_receivable')
    case 'disbursement':
      return settlementLines(sheet, ctx, 'accounts_payable')
    case 'general_journal':
      return generalJournalLines(sheet, ctx)
    case 'payroll_register':
      return payrollLines(sheet, ctx)
  }
}

function saleLines(sheet: Sheet, ctx: PostingContext): JournalLineInput[] {
  const { accounts, party } = ctx
  const { lines, totals } = deriveDocumentTotals(
    taxContextFor(sheet, ctx),
    sheet.lines.map((l) => ({
      amount: Money.fromCentavos(l.amountCentavos),
      amountIsVatInclusive: l.amountIsVatInclusive,
      vatClass: l.vatClass,
      atc: l.atc,
    })),
  )

  const out: JournalLineInput[] = []
  // Receivable/cash side. Credit memos mirror the invoice with sides swapped.
  const reversed = sheet.type === 'credit_memo'
  const debitAccount =
    sheet.type === 'sales_receipt'
      ? accounts.byRole('cash')
      : accounts.byRole('accounts_receivable')
  const receivable = totals.amountDue
  out.push(
    side(reversed, { accountCode: debitAccount.code, debit: receivable, partyId: party?.id ?? null }),
  )
  // Taxes withheld by the customer are assets to us (creditable).
  if (!totals.withholdingTotal.isZero()) {
    const acct = accounts.byTag('creditable_wtax_receivable')
    out.push(side(reversed, { accountCode: acct.code, debit: totals.withholdingTotal, taxTag: acct.taxTag }))
  }
  if (!totals.governmentVatWithheld.isZero()) {
    const acct = accounts.byTag('creditable_wtax_receivable')
    out.push(side(reversed, { accountCode: acct.code, debit: totals.governmentVatWithheld, taxTag: acct.taxTag }))
  }
  // Income side, split by VAT class so books and 2550Q derive from tags.
  lines.forEach((d, i) => {
    const explicit = sheet.lines[i]?.accountCode
    const acct = explicit
      ? accounts.byCode(explicit)
      : ctx.profile.businessTaxRegime === 'vat'
        ? accounts.byTag(salesTagFor(d.vatClass))
        : accounts.byRole('sales')
    out.push(side(reversed, { accountCode: acct.code, credit: d.net, taxTag: acct.taxTag, partyId: party?.id ?? null }))
  })
  if (!totals.vat.isZero()) {
    const acct = accounts.byTag('output_vat')
    out.push(side(reversed, { accountCode: acct.code, credit: totals.vat, taxTag: acct.taxTag }))
  }
  return out
}

function purchaseLines(sheet: Sheet, ctx: PostingContext): JournalLineInput[] {
  const { accounts, party } = ctx
  const { lines, totals } = deriveDocumentTotals(
    taxContextFor(sheet, ctx),
    sheet.lines.map((l) => ({
      amount: Money.fromCentavos(l.amountCentavos),
      amountIsVatInclusive: l.amountIsVatInclusive,
      vatClass: l.vatClass,
      atc: l.atc,
    })),
  )

  const out: JournalLineInput[] = []
  const reversed = sheet.type === 'debit_memo'
  // Expense/asset side per line (net for VAT companies, gross for non-VAT).
  sheet.lines.forEach((sl, i) => {
    const d = lines[i]!
    const acct = sl.accountCode
      ? accounts.byCode(sl.accountCode)
      : sl.itemId && ctx.itemAccountCodes?.get(sl.itemId)?.expense
        ? accounts.byCode(ctx.itemAccountCodes.get(sl.itemId)!.expense!)
        : accounts.byRole('purchases')
    const cost = ctx.profile.businessTaxRegime === 'vat' ? d.net : d.gross
    out.push(side(reversed, { accountCode: acct.code, debit: cost, taxTag: acct.taxTag, partyId: party?.id ?? null, description: sl.description }))
  })
  if (!totals.vat.isZero()) {
    const acct = accounts.byTag('input_vat')
    out.push(side(reversed, { accountCode: acct.code, debit: totals.vat, taxTag: acct.taxTag }))
  }
  // What we withhold is a liability to BIR, not part of the payable to the supplier.
  if (!totals.withholdingTotal.isZero()) {
    const kind = sheet.lines.some((l) => l.atc?.startsWith('WI2') || l.atc?.startsWith('WC2'))
    const acct = accounts.byTag(kind ? 'fwt_payable' : 'ewt_payable')
    out.push(side(reversed, { accountCode: acct.code, credit: totals.withholdingTotal, taxTag: acct.taxTag }))
  }
  const payable = totals.amountDue
  out.push(side(reversed, { accountCode: accounts.byRole('accounts_payable').code, credit: payable, partyId: party?.id ?? null }))
  return out
}

/** Collection: Dr cash / Cr AR. Disbursement: Dr AP / Cr cash (plus EWT held at payment). */
function settlementLines(
  sheet: Sheet,
  ctx: PostingContext,
  settles: 'accounts_receivable' | 'accounts_payable',
): JournalLineInput[] {
  const { accounts, party } = ctx
  const bank = sheet.bankAccountCode ? accounts.byCode(sheet.bankAccountCode) : accounts.byRole('cash')
  const out: JournalLineInput[] = []
  const total = sum(sheet.lines.map((l) => Money.fromCentavos(l.amountCentavos)))

  if (settles === 'accounts_receivable') {
    out.push({ accountCode: bank.code, debit: total })
    out.push({ accountCode: accounts.byRole('accounts_receivable').code, credit: total, partyId: party?.id ?? null })
    return out
  }

  // Disbursement may settle AP or pay expenses directly, per line accountCode;
  // cash-basis EWT is withheld at payment time.
  let cashOut = Money.ZERO
  for (const l of sheet.lines) {
    const amount = Money.fromCentavos(l.amountCentavos)
    const acct = l.accountCode ? accounts.byCode(l.accountCode) : accounts.byRole('accounts_payable')
    out.push({ accountCode: acct.code, debit: amount, taxTag: acct.taxTag, partyId: party?.id ?? null, description: l.description })
    let net = amount
    if (l.atc && (ctx.profile.withholdingAgent.expanded || ctx.profile.withholdingAgent.final)) {
      const { totals } = deriveDocumentTotals(taxContextFor(sheet, ctx), [
        { amount, amountIsVatInclusive: l.amountIsVatInclusive, vatClass: l.vatClass, atc: l.atc },
      ])
      if (!totals.withholdingTotal.isZero()) {
        const acctW = accounts.byTag('ewt_payable')
        out.push({ accountCode: acctW.code, credit: totals.withholdingTotal, taxTag: acctW.taxTag })
        net = net.subtract(totals.withholdingTotal)
      }
    }
    cashOut = cashOut.add(net)
  }
  out.push({ accountCode: bank.code, credit: cashOut })
  return out
}

function generalJournalLines(sheet: Sheet, ctx: PostingContext): JournalLineInput[] {
  return sheet.lines.map((l) => {
    if (!l.accountCode || !l.side) {
      throw new PostingError(`General journal line ${l.lineNo} needs an account and a side`)
    }
    const acct = ctx.accounts.byCode(l.accountCode)
    const amount = Money.fromCentavos(l.amountCentavos)
    return {
      accountCode: acct.code,
      debit: l.side === 'debit' ? amount : undefined,
      credit: l.side === 'credit' ? amount : undefined,
      taxTag: acct.taxTag,
      description: l.description,
    }
  })
}

/**
 * Payroll register: one line per employee. amountCentavos is basic pay;
 * the optional payroll block carries other taxable pay, the 13th-month/
 * other-benefits bucket, de minimis, and employee-share statutory
 * contributions. Posts gross to salaries expense, withheld tax and the
 * employee-share contributions to their payables, net to salaries payable.
 * (Employer-share contributions post separately — their tables are a
 * planned rules table, not engine logic.)
 */
function payrollLines(sheet: Sheet, ctx: PostingContext): JournalLineInput[] {
  const { accounts } = ctx
  let gross = Money.ZERO
  let wtax = Money.ZERO
  let contributions = Money.ZERO
  for (const l of sheet.lines) {
    const p = l.payroll
    const r = computePayrollWithholding(
      {
        frequency: sheet.payrollFrequency ?? 'monthly',
        basicPay: Money.fromCentavos(l.amountCentavos),
        otherTaxable: Money.fromCentavos(p?.otherTaxableCentavos ?? 0),
        thirteenthMonthAndOtherBenefits: Money.fromCentavos(p?.thirteenthMonthCentavos ?? 0),
        thirteenthMonthYtdBefore: Money.ZERO,
        // The register's de-minimis column is a within-caps lump (no per-kind
        // breakdown at sheet level), so it stays out of the taxable base.
        deMinimis: [],
        mandatoryContributions: Money.fromCentavos(p?.mandatoryContributionsCentavos ?? 0),
      },
      sheet.date,
    )
    gross = gross
      .add(Money.fromCentavos(l.amountCentavos))
      .add(Money.fromCentavos(p?.otherTaxableCentavos ?? 0))
      .add(Money.fromCentavos(p?.thirteenthMonthCentavos ?? 0))
      .add(Money.fromCentavos(p?.deMinimisCentavos ?? 0))
    wtax = wtax.add(r.withholding)
    contributions = contributions.add(Money.fromCentavos(p?.mandatoryContributionsCentavos ?? 0))
  }
  if (!ctx.profile.withholdingAgent.compensation && !wtax.isZero()) {
    throw new PostingError(
      'This company is not registered as a compensation withholding agent but payroll requires withholding',
    )
  }
  const salaries = accounts.byRole('salaries_expense')
  const out: JournalLineInput[] = [
    { accountCode: salaries.code, debit: gross, taxTag: salaries.taxTag },
  ]
  if (!wtax.isZero()) {
    const acct = accounts.byTag('compensation_wtax_payable')
    out.push({ accountCode: acct.code, credit: wtax, taxTag: acct.taxTag })
  }
  if (!contributions.isZero()) {
    const acct = accounts.byTag('sss_philhealth_pagibig_payable')
    out.push({ accountCode: acct.code, credit: contributions, taxTag: acct.taxTag })
  }
  out.push({
    accountCode: accounts.byRole('salaries_payable').code,
    credit: gross.subtract(wtax).subtract(contributions),
  })
  return out
}

/** Swap debit/credit when a memo mirrors its base document. */
function side(
  reversed: boolean,
  line: JournalLineInput & { debit?: Money; credit?: Money },
): JournalLineInput {
  if (!reversed) return line
  return { ...line, debit: line.credit, credit: line.debit }
}
