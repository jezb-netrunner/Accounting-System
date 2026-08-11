import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalAdapter } from '../data/adapters/local/LocalAdapter'
import type { DataPort } from '../data/ports'
import { instantiateTemplate } from './coa'
import { Money } from '../lib/money'
import { draftCorrectionCopy, postSheetDocument, reverseSheetEntry } from './postingService'
import type { Sheet } from './sheets'
import { coaTemplateForProfile } from '../seed/coaTemplates'
import { VAT_CORPORATION_PROFILE } from '../seed/profiles'

const COMPANY = 'co-post-test'

const draft = (over: Partial<Sheet> = {}): Sheet => ({
  id: `${COMPANY}:s1`,
  companyId: COMPANY,
  type: 'sales_invoice',
  documentNo: '',
  date: '2026-02-10',
  partyId: null,
  memo: '',
  lines: [
    {
      lineNo: 1,
      description: 'Widgets',
      accountCode: null,
      itemId: null,
      quantity: null,
      amountCentavos: 112_000_00,
      amountIsVatInclusive: true,
      vatClass: 'vatable',
      atc: null,
      side: null,
    },
  ],
  status: 'draft',
  postedEntryId: null,
  bankAccountCode: null,
  payrollPeriod: null,
  ...over,
})

let port: DataPort
let n = 0

beforeEach(async () => {
  port = createLocalAdapter(`post-test-${++n}`)
  await port.accounts.saveMany(instantiateTemplate(COMPANY, coaTemplateForProfile(VAT_CORPORATION_PROFILE)))
  await port.numbering.save({
    id: 'series-si',
    companyId: COMPANY,
    documentType: 'sales_invoice',
    prefix: 'SI-',
    padding: 4,
    nextNumber: 100,
    authorityRef: null,
  })
})

const request = (sheet: Sheet) => ({
  sheet,
  profile: VAT_CORPORATION_PROFILE,
  accounts: [] as never[], // filled per test
  party: null,
  locks: [],
  now: '2026-02-10T08:00:00Z',
  seriesId: 'series-si' as string | null,
})

describe('postSheetDocument', () => {
  it('reserves the document number at post time, not draft time', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft()
    await port.sheets.saveDraft(s)
    // Draft saved with no number; series untouched.
    expect((await port.numbering.list(COMPANY))[0]!.nextNumber).toBe(100)

    const { documentNo, entry } = await postSheetDocument(port, { ...request(s), accounts })
    expect(documentNo).toBe('SI-0100')
    expect((await port.numbering.list(COMPANY))[0]!.nextNumber).toBe(101)

    const saved = await port.sheets.get(s.id)
    expect(saved!.status).toBe('posted')
    expect(saved!.documentNo).toBe('SI-0100')
    expect(saved!.postedEntryId).toBe(entry.id)
    expect(await port.journal.list(COMPANY)).toHaveLength(1)
  })

  it('keeps a manually typed number instead of claiming from the series', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft({ documentNo: 'SI-CUSTOM-1' })
    const { documentNo } = await postSheetDocument(port, { ...request(s), accounts })
    expect(documentNo).toBe('SI-CUSTOM-1')
    expect((await port.numbering.list(COMPANY))[0]!.nextNumber).toBe(100)
  })

  it('does not burn a number when validation fails (dry run first)', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const bad = draft({ lines: [] })
    await expect(postSheetDocument(port, { ...request(bad), accounts })).rejects.toThrow(/empty/)
    expect((await port.numbering.list(COMPANY))[0]!.nextNumber).toBe(100)
    expect(await port.journal.list(COMPANY)).toHaveLength(0)
  })

  it('refuses to post into a locked period', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft()
    await expect(
      postSheetDocument(port, {
        ...request(s),
        accounts,
        locks: [{ companyId: COMPANY, periodKey: '2026-02', lockedAt: '', lockedBy: 'test' }],
      }),
    ).rejects.toThrow(/locked/)
  })

  it('posting twice is rejected by the atomic write', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft()
    await postSheetDocument(port, { ...request(s), accounts })
    await expect(postSheetDocument(port, { ...request(s), accounts })).rejects.toThrow(/already/)
  })

  it('writes an audit row on post', async () => {
    const accounts = await port.accounts.list(COMPANY)
    await postSheetDocument(port, { ...request(draft()), accounts })
    const audit = await port.audit.list(COMPANY)
    expect(audit.some((a) => a.action === 'sheet_posted' && a.subject === 'sheet:SI-0100')).toBe(true)
  })

  it('reversal mirrors the original, references it, and refuses locked periods', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const { entry } = await postSheetDocument(port, { ...request(draft()), accounts })

    await expect(
      reverseSheetEntry(port, {
        original: entry,
        reason: 'wrong customer',
        date: '2026-02-15',
        locks: [{ companyId: COMPANY, periodKey: '2026-02', lockedAt: '', lockedBy: 't' }],
        now: '2026-02-15T00:00:00Z',
      }),
    ).rejects.toThrow(/locked/)

    const reversal = await reverseSheetEntry(port, {
      original: entry,
      reason: 'wrong customer',
      date: '2026-02-15',
      locks: [],
      now: '2026-02-15T00:00:00Z',
    })
    expect(reversal.reversalOfEntryId).toBe(entry.id)
    // Sides swapped, amounts identical: together they sum to zero per account.
    const byAccount = new Map<string, number>()
    for (const e of [entry, reversal]) {
      for (const l of e.lines) {
        byAccount.set(
          l.accountCode,
          (byAccount.get(l.accountCode) ?? 0) + l.debitCentavos - l.creditCentavos,
        )
      }
    }
    expect([...byAccount.values()].every((v) => v === 0)).toBe(true)
    expect(await port.journal.list(COMPANY)).toHaveLength(2)
  })

  it('correction drafts a fresh copy with no number, ready to re-post', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft()
    await postSheetDocument(port, { ...request(s), accounts })
    const posted = (await port.sheets.get(s.id))!
    const copy = await draftCorrectionCopy(port, posted)
    expect(copy.id).not.toBe(posted.id)
    expect(copy.status).toBe('draft')
    expect(copy.documentNo).toBe('')
    expect(copy.lines).toEqual(posted.lines)
    expect(Money.fromCentavos(copy.lines[0]!.amountCentavos).format()).toBe('112,000.00')
  })

  it('drafts are deletable; posted sheets are not', async () => {
    const accounts = await port.accounts.list(COMPANY)
    const s = draft()
    await port.sheets.saveDraft(s)
    await port.sheets.deleteDraft(s.id)
    expect(await port.sheets.get(s.id)).toBeNull()

    const s2 = draft({ id: `${COMPANY}:s2` })
    await port.sheets.saveDraft(s2)
    await postSheetDocument(port, { ...request(s2), accounts })
    await expect(port.sheets.deleteDraft(s2.id)).rejects.toThrow(/posted/)
  })
})
