import type { DataPort } from '../data/ports'
import type { AtcRateRule } from '../tax/rules/withholding'
import { auditEvent } from './audit'
import type { Account } from './coa'
import { reverseEntry, type JournalEntry } from './journal'
import type { Party } from './masterData'
import { assertPostingAllowed, type PeriodLock } from './periodClose'
import { indexAccounts, postSheet } from './posting'
import type { Sheet } from './sheets'
import type { TaxProfile } from './taxProfile'

/**
 * The one posting flow every sheet page uses:
 *  1. dry-run the posting first, so validation errors surface before a
 *     document number is consumed;
 *  2. reserve the number from the series (post time, never draft time);
 *  3. write sheet + entry through the port's atomic postDocument.
 * A failed atomic write after a claim burns the number — sequential-numbering
 * gaps must be explainable, and a storage failure is exactly that.
 */
export interface PostRequest {
  readonly sheet: Sheet // draft; documentNo may be empty when a series exists
  readonly profile: TaxProfile
  readonly accounts: readonly Account[]
  readonly party: Party | null
  readonly locks: readonly PeriodLock[]
  readonly customAtcRates?: readonly AtcRateRule[]
  readonly now: string
  /** Series to reserve the number from; null = keep the typed documentNo. */
  readonly seriesId: string | null
}

export async function postSheetDocument(
  port: DataPort,
  req: PostRequest,
): Promise<{ entry: JournalEntry; documentNo: string }> {
  assertPostingAllowed(req.sheet.date, req.locks)

  const accounts = indexAccounts(req.accounts)
  const entryNo = await port.journal.nextEntryNo(req.sheet.companyId)
  const entryId = `${req.sheet.companyId}:je:${entryNo}`
  const buildEntry = (sheet: Sheet) =>
    postSheet(sheet, {
      profile: req.profile,
      accounts,
      party: req.party,
      entryId,
      entryNo,
      postedAt: req.now,
      customAtcRates: req.customAtcRates,
    })

  // Dry run with the draft as-is: throws before any number is claimed.
  buildEntry(req.sheet)

  let documentNo = req.sheet.documentNo
  if (req.seriesId && !documentNo) {
    documentNo = (await port.numbering.claimNext(req.seriesId)).documentNo
  }
  if (!documentNo) {
    throw new Error('No document number: type one or set up a numbering series for this sheet type')
  }

  const draft: Sheet = { ...req.sheet, documentNo }
  const entry = buildEntry(draft)
  const posted: Sheet = { ...draft, status: 'posted', postedEntryId: entry.id }
  await port.postDocument({ sheet: posted, entry })
  await port.audit.append(
    auditEvent(
      req.sheet.companyId,
      'sheet_posted',
      `sheet:${documentNo}`,
      `${req.sheet.type.replace(/_/g, ' ')} ${documentNo} posted as entry #${entryNo}`,
      { at: req.now },
    ),
  )
  return { entry, documentNo }
}

/**
 * Reversal: a mirrored entry referencing the original. The original stays
 * untouched (immutable); the reversal posts into an OPEN period — locked
 * history is corrected forward, never rewritten.
 */
export async function reverseSheetEntry(
  port: DataPort,
  req: {
    original: JournalEntry
    reason: string
    date: string
    locks: readonly PeriodLock[]
    now: string
  },
): Promise<JournalEntry> {
  assertPostingAllowed(req.date, req.locks)
  const entryNo = await port.journal.nextEntryNo(req.original.companyId)
  const reversal = reverseEntry(req.original, {
    id: `${req.original.companyId}:je:${entryNo}`,
    entryNo,
    date: req.date,
    postedAt: req.now,
    reason: req.reason,
  })
  await port.journal.append(reversal)
  await port.audit.append(
    auditEvent(
      req.original.companyId,
      'entry_reversed',
      `entry:${req.original.entryNo}`,
      `Entry #${req.original.entryNo} reversed by #${entryNo}: ${req.reason}`,
      { at: req.now },
    ),
  )
  return reversal
}

/**
 * Correction = reverse, then re-post as a NEW document: this drafts the
 * copy (fresh id, no document number — the series assigns one when the
 * corrected document posts).
 */
export async function draftCorrectionCopy(port: DataPort, source: Sheet): Promise<Sheet> {
  const copy: Sheet = {
    ...source,
    id: `${source.companyId}:${source.type}:${crypto.randomUUID()}`,
    documentNo: '',
    status: 'draft',
    postedEntryId: null,
    memo: source.memo || `Correction of ${source.documentNo}`,
  }
  await port.sheets.saveDraft(copy)
  await port.audit.append(
    auditEvent(
      source.companyId,
      'correction_drafted',
      `sheet:${source.documentNo}`,
      `Correction draft created from ${source.documentNo}`,
    ),
  )
  return copy
}
