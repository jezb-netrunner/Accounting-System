// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { Money } from '../../../lib/money'
import { createJournalEntry } from '../../../domain/journal'
import { VAT_CORPORATION_PROFILE } from '../../../seed/profiles'
import { AppendOnlyViolationError, createLocalAdapter } from './LocalAdapter'

let dbCount = 0
const freshPort = () => createLocalAdapter(`test-db-${++dbCount}`)

const entry = (id: string, entryNo: number) =>
  createJournalEntry({
    id,
    companyId: 'co-1',
    entryNo,
    date: '2026-03-15',
    description: 'test',
    postedAt: '2026-03-15T08:00:00Z',
    lines: [
      { accountCode: '1200', debit: Money.pesos(10) },
      { accountCode: '4100', credit: Money.pesos(10) },
    ],
  })

describe('LocalAdapter (Dexie over fake-indexeddb)', () => {
  it('round-trips a tax profile including the registration set', async () => {
    const port = freshPort()
    await port.taxProfiles.save('co-1', VAT_CORPORATION_PROFILE)
    const back = await port.taxProfiles.resolveAt('co-1', '2026-01-01')
    expect(back).not.toBeNull()
    expect(back!.registeredTaxTypes).toBeInstanceOf(Set)
    expect(back!.registeredTaxTypes.has('vat')).toBe(true)
    expect(await port.taxProfiles.resolveAt('co-1', '2018-01-01')).toBeNull()
  })

  it('journal is append-only: same id can never be written twice', async () => {
    const port = freshPort()
    await port.journal.append(entry('je-1', 1))
    await expect(port.journal.append(entry('je-1', 2))).rejects.toThrow(AppendOnlyViolationError)
    expect(await port.journal.nextEntryNo('co-1')).toBe(2)
  })

  it('numbering claims are sequential', async () => {
    const port = freshPort()
    await port.numbering.save({
      id: 'ns-1',
      companyId: 'co-1',
      documentType: 'sales_invoice',
      prefix: 'SI-',
      padding: 4,
      nextNumber: 7,
      authorityRef: null,
    })
    const a = await port.numbering.claimNext('ns-1')
    const b = await port.numbering.claimNext('ns-1')
    expect(a.documentNo).toBe('SI-0007')
    expect(b.documentNo).toBe('SI-0008')
  })

  it('posted sheets refuse mutation and voiding', async () => {
    const port = freshPort()
    const draft = {
      id: 's-1',
      companyId: 'co-1',
      type: 'sales_invoice' as const,
      documentNo: 'SI-0001',
      date: '2026-03-15',
      partyId: null,
      memo: '',
      lines: [],
      status: 'draft' as const,
      postedEntryId: null,
      bankAccountCode: null,
      payrollPeriod: null,
    }
    await port.sheets.saveDraft(draft)
    await port.sheets.markPosted('s-1', 'je-1')
    await expect(port.sheets.saveDraft(draft)).rejects.toThrow(AppendOnlyViolationError)
    await expect(port.sheets.markVoid('s-1')).rejects.toThrow(AppendOnlyViolationError)
    await expect(port.sheets.markPosted('s-1', 'je-2')).rejects.toThrow(AppendOnlyViolationError)
  })
})
