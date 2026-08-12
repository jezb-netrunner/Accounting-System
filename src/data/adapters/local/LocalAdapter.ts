import Dexie, { type Table } from 'dexie'
import type { AuditEvent } from '../../../domain/audit'
import type { Account } from '../../../domain/coa'
import type { CompanyId } from '../../../domain/core'
import type { JournalEntry } from '../../../domain/journal'
import type {
  AtcCode,
  BankAccount,
  Employee,
  Item,
  NumberingSeries,
  Party,
} from '../../../domain/masterData'
import { formatDocumentNo } from '../../../domain/masterData'
import type { PeriodLock } from '../../../domain/periodClose'
import type { Sheet } from '../../../domain/sheets'
import type { TaxProfile } from '../../../domain/taxProfile'
import type { GeneratedReturn } from '../../../reports/returns/context'
import type { Company, DataPort } from '../../ports'

/**
 * LocalAdapter: IndexedDB via Dexie. Fully offline; this is the adapter the
 * app ships with today. It is also where the append-only guarantees are
 * enforced at the storage boundary (defense in depth — the domain layer
 * already refuses to construct bad data).
 */

/** Sets don't round-trip predictably through every backend; store arrays. */
type StoredTaxProfile = Omit<TaxProfile, 'registeredTaxTypes'> & {
  companyId: CompanyId
  registeredTaxTypes: string[]
}

class PhBooksDB extends Dexie {
  companies!: Table<Company, string>
  taxProfiles!: Table<StoredTaxProfile, [string, string]>
  accounts!: Table<Account, string>
  parties!: Table<Party, string>
  employees!: Table<Employee, string>
  bankAccounts!: Table<BankAccount, string>
  items!: Table<Item, string>
  atcCodes!: Table<AtcCode, string>
  numbering!: Table<NumberingSeries, string>
  sheets!: Table<Sheet, string>
  journal!: Table<JournalEntry, string>
  periodLocks!: Table<PeriodLock, [string, string]>
  audit!: Table<AuditEvent, string>
  generatedReturns!: Table<GeneratedReturn, string>

  constructor(name = 'ph-books') {
    super(name)
    this.version(1).stores({
      companies: 'id',
      taxProfiles: '[companyId+effectiveFrom], companyId',
      accounts: 'id, companyId, [companyId+code]',
      parties: 'id, companyId',
      employees: 'id, companyId',
      bankAccounts: 'id, companyId',
      items: 'id, companyId',
      numbering: 'id, companyId',
      sheets: 'id, companyId, [companyId+type], [companyId+status]',
      journal: 'id, companyId, [companyId+entryNo], [companyId+date]',
      periodLocks: '[companyId+periodKey], companyId',
    })
    this.version(2).stores({
      atcCodes: 'id, companyId',
    })
    this.version(3).stores({
      audit: 'id, companyId, [companyId+at]',
    })
    this.version(4).stores({
      generatedReturns: 'id, companyId, [companyId+formCode]',
    })
  }
}

export class AppendOnlyViolationError extends Error {}

export function createLocalAdapter(dbName?: string): DataPort {
  const db = new PhBooksDB(dbName)

  return {
    postDocument: async ({ sheet, entry }) => {
      if (sheet.status !== 'posted' || sheet.postedEntryId !== entry.id) {
        throw new AppendOnlyViolationError('postDocument expects a posted sheet bound to its entry')
      }
      await db.transaction('rw', db.sheets, db.journal, async () => {
        const existingSheet = await db.sheets.get(sheet.id)
        if (existingSheet && existingSheet.status !== 'draft') {
          throw new AppendOnlyViolationError(
            `Sheet ${sheet.documentNo} is already ${existingSheet.status}`,
          )
        }
        const existingEntry = await db.journal.get(entry.id)
        if (existingEntry) {
          throw new AppendOnlyViolationError(`Journal entry ${entry.id} already exists`)
        }
        await db.sheets.put(sheet)
        await db.journal.add(entry)
      })
    },
    companies: {
      list: () => db.companies.toArray(),
      get: async (id) => (await db.companies.get(id)) ?? null,
      save: async (company) => {
        await db.companies.put(company)
      },
    },

    taxProfiles: {
      listVersions: async (companyId) => {
        const rows = await db.taxProfiles.where('companyId').equals(companyId).toArray()
        return rows
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
          .map(restoreProfile)
      },
      resolveAt: async (companyId, date) => {
        const rows = await db.taxProfiles.where('companyId').equals(companyId).toArray()
        const hit = rows.find(
          (p) => p.effectiveFrom <= date && (p.effectiveTo === null || date <= p.effectiveTo),
        )
        return hit ? restoreProfile(hit) : null
      },
      save: async (companyId, profile) => {
        await db.taxProfiles.put({
          ...profile,
          companyId,
          registeredTaxTypes: [...profile.registeredTaxTypes],
        })
      },
    },

    accounts: {
      list: (companyId) => db.accounts.where('companyId').equals(companyId).sortBy('code'),
      saveMany: async (accounts) => {
        await db.accounts.bulkPut([...accounts])
      },
    },

    parties: {
      list: (companyId) => db.parties.where('companyId').equals(companyId).toArray(),
      get: async (id) => (await db.parties.get(id)) ?? null,
      save: async (party) => {
        await db.parties.put(party)
      },
      delete: async (id) => {
        await db.parties.delete(id)
      },
    },

    employees: {
      list: (companyId) => db.employees.where('companyId').equals(companyId).toArray(),
      save: async (employee) => {
        await db.employees.put(employee)
      },
      delete: async (id) => {
        await db.employees.delete(id)
      },
    },

    bankAccounts: {
      list: (companyId) => db.bankAccounts.where('companyId').equals(companyId).toArray(),
      save: async (account) => {
        await db.bankAccounts.put(account)
      },
      delete: async (id) => {
        await db.bankAccounts.delete(id)
      },
    },

    items: {
      list: (companyId) => db.items.where('companyId').equals(companyId).toArray(),
      save: async (item) => {
        await db.items.put(item)
      },
      delete: async (id) => {
        await db.items.delete(id)
      },
    },

    atcCodes: {
      list: (companyId) => db.atcCodes.where('companyId').equals(companyId).toArray(),
      save: async (code) => {
        await db.atcCodes.put(code)
      },
      delete: async (id) => {
        await db.atcCodes.delete(id)
      },
    },

    numbering: {
      list: (companyId) => db.numbering.where('companyId').equals(companyId).toArray(),
      claimNext: (seriesId) =>
        db.transaction('rw', db.numbering, async () => {
          const series = await db.numbering.get(seriesId)
          if (!series) throw new Error(`No numbering series ${seriesId}`)
          const number = series.nextNumber
          await db.numbering.put({ ...series, nextNumber: number + 1 })
          return { documentNo: formatDocumentNo(series, number), number }
        }),
      save: async (series) => {
        await db.numbering.put(series)
      },
    },

    sheets: {
      list: async (companyId, filter) => {
        let rows = await db.sheets.where('companyId').equals(companyId).toArray()
        if (filter?.type) rows = rows.filter((s) => s.type === filter.type)
        if (filter?.status) rows = rows.filter((s) => s.status === filter.status)
        return rows.sort((a, b) => b.date.localeCompare(a.date))
      },
      get: async (id) => (await db.sheets.get(id)) ?? null,
      saveDraft: async (sheet) => {
        if (sheet.status !== 'draft') {
          throw new AppendOnlyViolationError('saveDraft only accepts draft sheets')
        }
        await db.transaction('rw', db.sheets, async () => {
          const existing = await db.sheets.get(sheet.id)
          if (existing && existing.status !== 'draft') {
            throw new AppendOnlyViolationError(
              `Sheet ${sheet.documentNo} is ${existing.status} and can no longer change`,
            )
          }
          await db.sheets.put(sheet)
        })
      },
      deleteDraft: async (sheetId) => {
        await db.transaction('rw', db.sheets, async () => {
          const existing = await db.sheets.get(sheetId)
          if (!existing) return
          if (existing.status !== 'draft') {
            throw new AppendOnlyViolationError(
              `Sheet ${existing.documentNo} is ${existing.status} and cannot be deleted`,
            )
          }
          await db.sheets.delete(sheetId)
        })
      },
      markPosted: async (sheetId, entryId) => {
        await db.transaction('rw', db.sheets, async () => {
          const existing = await db.sheets.get(sheetId)
          if (!existing) throw new Error(`No sheet ${sheetId}`)
          if (existing.status !== 'draft') {
            throw new AppendOnlyViolationError(`Sheet is ${existing.status}, not draft`)
          }
          await db.sheets.put({ ...existing, status: 'posted', postedEntryId: entryId })
        })
      },
      markVoid: async (sheetId) => {
        await db.transaction('rw', db.sheets, async () => {
          const existing = await db.sheets.get(sheetId)
          if (!existing) throw new Error(`No sheet ${sheetId}`)
          if (existing.status === 'posted') {
            throw new AppendOnlyViolationError(
              'Posted sheets cannot be voided; post a reversal instead',
            )
          }
          await db.sheets.put({ ...existing, status: 'void' })
        })
      },
    },

    journal: {
      append: async (entry) => {
        await db.transaction('rw', db.journal, async () => {
          const existing = await db.journal.get(entry.id)
          if (existing) {
            throw new AppendOnlyViolationError(
              `Journal entry ${entry.id} already exists; entries are immutable`,
            )
          }
          await db.journal.add(entry)
        })
      },
      list: async (companyId, range) => {
        let rows = await db.journal.where('companyId').equals(companyId).toArray()
        if (range) rows = rows.filter((e) => e.date >= range.from && e.date <= range.to)
        return rows.sort((a, b) => a.entryNo - b.entryNo)
      },
      nextEntryNo: async (companyId) => {
        const rows = await db.journal.where('companyId').equals(companyId).toArray()
        return rows.reduce((max, e) => Math.max(max, e.entryNo), 0) + 1
      },
    },

    periodLocks: {
      list: (companyId) => db.periodLocks.where('companyId').equals(companyId).toArray(),
      append: async (lock) => {
        await db.periodLocks.add(lock)
      },
      remove: async (companyId, periodKey) => {
        await db.periodLocks.delete([companyId, periodKey])
      },
    },

    audit: {
      append: async (event) => {
        await db.audit.add(event)
      },
      list: async (companyId, limit = 500) => {
        const rows = await db.audit.where('companyId').equals(companyId).toArray()
        return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
      },
    },

    generatedReturns: {
      list: (companyId) => db.generatedReturns.where('companyId').equals(companyId).toArray(),
      save: async (generated) => {
        await db.generatedReturns.put(generated)
      },
      delete: async (id) => {
        await db.generatedReturns.delete(id)
      },
    },
  }
}

const restoreProfile = (row: StoredTaxProfile): TaxProfile => {
  const { companyId: _companyId, registeredTaxTypes, ...rest } = row
  return { ...rest, registeredTaxTypes: new Set(registeredTaxTypes as never[]) } as TaxProfile
}
