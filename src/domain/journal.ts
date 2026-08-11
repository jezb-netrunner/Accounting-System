import { Money, sum } from '../lib/money'
import type { CompanyId, ISODate, JournalEntryId, PartyId, SheetId } from './core'
import type { TaxTag } from './coa'

/**
 * The ledger's atomic unit. Posted entries are append-only and immutable:
 * there is no update or delete anywhere in the domain or the data ports —
 * corrections happen by posting reversing entries.
 */
export interface JournalLine {
  readonly accountCode: string
  readonly debitCentavos: number
  readonly creditCentavos: number
  readonly partyId: PartyId | null
  /** Carried from the account at posting time so books can group without a COA join. */
  readonly taxTag: TaxTag
  readonly description: string
}

export interface JournalEntry {
  readonly id: JournalEntryId
  readonly companyId: CompanyId
  readonly entryNo: number
  readonly date: ISODate
  readonly description: string
  readonly sheetId: SheetId | null
  readonly lines: readonly JournalLine[]
  readonly postedAt: string
  /** Set when this entry reverses another; the original stays untouched. */
  readonly reversalOfEntryId: JournalEntryId | null
}

export class UnbalancedEntryError extends Error {
  constructor(debits: Money, credits: Money) {
    super(`Journal entry does not balance: debits ${debits.format()} ≠ credits ${credits.format()}`)
  }
}

export class InvalidEntryError extends Error {}

export interface JournalLineInput {
  readonly accountCode: string
  readonly debit?: Money
  readonly credit?: Money
  readonly partyId?: PartyId | null
  readonly taxTag?: TaxTag
  readonly description?: string
}

/**
 * The only constructor for journal entries. Validates the double-entry
 * invariant and deep-freezes the result — the trial balance ties by
 * construction because nothing unbalanced can exist.
 */
export function createJournalEntry(input: {
  id: JournalEntryId
  companyId: CompanyId
  entryNo: number
  date: ISODate
  description: string
  sheetId?: SheetId | null
  reversalOfEntryId?: JournalEntryId | null
  postedAt: string
  lines: readonly JournalLineInput[]
}): JournalEntry {
  const lines: JournalLine[] = input.lines
    // Zero lines are legal inputs (e.g. a tax that computed to zero) but never posted.
    .filter((l) => !(l.debit ?? Money.ZERO).isZero() || !(l.credit ?? Money.ZERO).isZero())
    .map((l, i) => {
      const debit = l.debit ?? Money.ZERO
      const credit = l.credit ?? Money.ZERO
      if (!debit.isZero() && !credit.isZero()) {
        throw new InvalidEntryError(`Line ${i + 1}: a line is either a debit or a credit, not both`)
      }
      if (debit.isNegative() || credit.isNegative()) {
        throw new InvalidEntryError(`Line ${i + 1}: negative amounts are not allowed; swap the side`)
      }
      return {
        accountCode: l.accountCode,
        debitCentavos: debit.centavos,
        creditCentavos: credit.centavos,
        partyId: l.partyId ?? null,
        taxTag: l.taxTag ?? 'none',
        description: l.description ?? input.description,
      }
    })

  if (lines.length < 2) {
    throw new InvalidEntryError('A journal entry needs at least two non-zero lines')
  }
  const debits = sum(lines.map((l) => Money.fromCentavos(l.debitCentavos)))
  const credits = sum(lines.map((l) => Money.fromCentavos(l.creditCentavos)))
  if (!debits.equals(credits)) throw new UnbalancedEntryError(debits, credits)

  const entry: JournalEntry = {
    id: input.id,
    companyId: input.companyId,
    entryNo: input.entryNo,
    date: input.date,
    description: input.description,
    sheetId: input.sheetId ?? null,
    lines,
    postedAt: input.postedAt,
    reversalOfEntryId: input.reversalOfEntryId ?? null,
  }
  lines.forEach(Object.freeze)
  Object.freeze(lines)
  return Object.freeze(entry)
}

/**
 * Corrections never mutate: a reversal is a new entry with sides swapped,
 * cross-referencing the original.
 */
export function reverseEntry(
  original: JournalEntry,
  input: { id: JournalEntryId; entryNo: number; date: ISODate; postedAt: string; reason: string },
): JournalEntry {
  return createJournalEntry({
    id: input.id,
    companyId: original.companyId,
    entryNo: input.entryNo,
    date: input.date,
    description: `Reversal of #${original.entryNo}: ${input.reason}`,
    sheetId: original.sheetId,
    reversalOfEntryId: original.id,
    postedAt: input.postedAt,
    lines: original.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: Money.fromCentavos(l.creditCentavos),
      credit: Money.fromCentavos(l.debitCentavos),
      partyId: l.partyId,
      taxTag: l.taxTag,
      description: l.description,
    })),
  })
}
