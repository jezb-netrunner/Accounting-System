import type { Account } from '../../domain/coa'
import type { AuditEvent } from '../../domain/audit'
import type { CompanyId, Period, RegisteredParty } from '../../domain/core'
import type { JournalEntry } from '../../domain/journal'
import type {
  AtcCode,
  BankAccount,
  Employee,
  Item,
  NumberingSeries,
  Party,
} from '../../domain/masterData'
import type { PeriodLock } from '../../domain/periodClose'
import type { Sheet } from '../../domain/sheets'
import type { TaxProfile } from '../../domain/taxProfile'
import type { GeneratedReturn } from '../../reports/returns/context'

/**
 * Repository ports. EVERY read/write in the app goes through these
 * interfaces; UI and domain code never touch Dexie or Supabase directly.
 * Swapping the backend is a one-file change in src/data/adapters/.
 */

export interface Company extends RegisteredParty {
  readonly id: CompanyId
  readonly createdAt: string
}

export interface CompanyRepository {
  list(): Promise<Company[]>
  get(id: CompanyId): Promise<Company | null>
  save(company: Company): Promise<void>
}

export interface TaxProfileRepository {
  /** Profile versions for a company, newest first. */
  listVersions(companyId: CompanyId): Promise<TaxProfile[]>
  /** The profile in force on a date (versioned by effectiveFrom/To). */
  resolveAt(companyId: CompanyId, date: string): Promise<TaxProfile | null>
  save(companyId: CompanyId, profile: TaxProfile): Promise<void>
}

export interface AccountRepository {
  list(companyId: CompanyId): Promise<Account[]>
  saveMany(accounts: readonly Account[]): Promise<void>
}

export interface PartyRepository {
  list(companyId: CompanyId): Promise<Party[]>
  get(id: string): Promise<Party | null>
  save(party: Party): Promise<void>
  /** Hard delete — callers must verify the record is unreferenced first. */
  delete(id: string): Promise<void>
}

export interface EmployeeRepository {
  list(companyId: CompanyId): Promise<Employee[]>
  save(employee: Employee): Promise<void>
  delete(id: string): Promise<void>
}

export interface BankAccountRepository {
  list(companyId: CompanyId): Promise<BankAccount[]>
  save(account: BankAccount): Promise<void>
  delete(id: string): Promise<void>
}

export interface ItemRepository {
  list(companyId: CompanyId): Promise<Item[]>
  save(item: Item): Promise<void>
  delete(id: string): Promise<void>
}

export interface AtcCodeRepository {
  list(companyId: CompanyId): Promise<AtcCode[]>
  save(code: AtcCode): Promise<void>
  delete(id: string): Promise<void>
}

export interface NumberingRepository {
  list(companyId: CompanyId): Promise<NumberingSeries[]>
  /** Atomically claim the next number in a series. */
  claimNext(seriesId: string): Promise<{ documentNo: string; number: number }>
  save(series: NumberingSeries): Promise<void>
}

export interface SheetRepository {
  list(companyId: CompanyId, filter?: { type?: Sheet['type']; status?: Sheet['status'] }): Promise<Sheet[]>
  get(id: string): Promise<Sheet | null>
  /** Drafts are mutable; posted/void sheets are not (adapter must reject). */
  saveDraft(sheet: Sheet): Promise<void>
  /** Drafts are deletable; posted/void sheets are not (adapter must reject). */
  deleteDraft(sheetId: string): Promise<void>
  /** Transition draft → posted, recording the entry id. Fails if not draft. */
  markPosted(sheetId: string, entryId: string): Promise<void>
  markVoid(sheetId: string): Promise<void>
}

export interface JournalRepository {
  /**
   * Append-only by design: there is no update or delete. Corrections are
   * reversing entries appended like any other.
   */
  append(entry: JournalEntry): Promise<void>
  list(companyId: CompanyId, range?: { from: string; to: string }): Promise<JournalEntry[]>
  nextEntryNo(companyId: CompanyId): Promise<number>
}

export interface PeriodLockRepository {
  list(companyId: CompanyId): Promise<PeriodLock[]>
  append(lock: PeriodLock): Promise<void>
  /** Unlocking is explicit and always paired with an audit row by the caller. */
  remove(companyId: CompanyId, periodKey: string): Promise<void>
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>
  /** Newest first. */
  list(companyId: CompanyId, limit?: number): Promise<AuditEvent[]>
}

export interface GeneratedReturnRepository {
  list(companyId: CompanyId): Promise<GeneratedReturn[]>
  /** Regenerating the same form+period replaces the snapshot. */
  save(generated: GeneratedReturn): Promise<void>
  delete(id: string): Promise<void>
}

/**
 * One atomic post: the sheet flips to posted (with its final document
 * number) and the journal entry appends in a single storage transaction —
 * either both land or neither does.
 */
export interface PostDocumentInput {
  readonly sheet: Sheet // status 'posted', postedEntryId set, final documentNo
  readonly entry: JournalEntry
}

/** The full data port the app is wired against. */
export interface DataPort {
  postDocument(input: PostDocumentInput): Promise<void>
  readonly companies: CompanyRepository
  readonly taxProfiles: TaxProfileRepository
  readonly accounts: AccountRepository
  readonly parties: PartyRepository
  readonly employees: EmployeeRepository
  readonly bankAccounts: BankAccountRepository
  readonly items: ItemRepository
  readonly atcCodes: AtcCodeRepository
  readonly numbering: NumberingRepository
  readonly sheets: SheetRepository
  readonly journal: JournalRepository
  readonly periodLocks: PeriodLockRepository
  readonly audit: AuditRepository
  readonly generatedReturns: GeneratedReturnRepository
}

export type { Period }
