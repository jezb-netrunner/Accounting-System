/** Shared primitives used across the domain. */

/** ISO-8601 calendar date, e.g. "2026-08-11". Domain logic never uses Date objects for business dates. */
export type ISODate = string

export const isoDate = (value: string): ISODate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ISO date: ${value}`)
  return value
}

/** Lexicographic comparison is chronological for ISO dates. */
export const dateInRange = (date: ISODate, from: ISODate, to: ISODate | null): boolean =>
  date >= from && (to === null || date <= to)

export type CompanyId = string
export type AccountId = string
export type PartyId = string
export type SheetId = string
export type JournalEntryId = string
export type ItemId = string
export type BankAccountId = string
export type EmployeeId = string

/**
 * Philippine TIN with branch code. The 9-digit base identifies the taxpayer;
 * the branch code (default "000" for head office, "00000" post-EOPT 5-digit
 * format) identifies the registered branch. Stored separately because BIR
 * forms and .DAT files render them in different widths.
 */
export interface TIN {
  /** 9 digits, no dashes. */
  readonly base: string
  /** 3- or 5-digit branch code; "000" = head office. */
  readonly branchCode: string
}

export const tin = (base: string, branchCode = '000'): TIN => {
  if (!/^\d{9}$/.test(base)) throw new Error(`TIN base must be 9 digits, got "${base}"`)
  if (!/^\d{3}(\d{2})?$/.test(branchCode)) {
    throw new Error(`TIN branch code must be 3 or 5 digits, got "${branchCode}"`)
  }
  return { base, branchCode }
}

export const formatTIN = (t: TIN): string =>
  `${t.base.slice(0, 3)}-${t.base.slice(3, 6)}-${t.base.slice(6, 9)}-${t.branchCode}`

/** Every registered party (the company itself, customers, suppliers) carries these. */
export interface RegisteredParty {
  readonly tin: TIN
  readonly registeredName: string
  /** Trade name / "business style" as it appears on invoices. */
  readonly businessStyle: string
  readonly registeredAddress: string
  readonly zipCode?: string
}

/** An accounting period: a month within a fiscal year. */
export interface Period {
  /** Calendar year the month falls in. */
  readonly year: number
  /** 1-12 calendar month. */
  readonly month: number
}

export const periodKey = (p: Period): string =>
  `${p.year}-${String(p.month).padStart(2, '0')}`

export const periodOfDate = (date: ISODate): Period => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
})

export const comparePeriods = (a: Period, b: Period): number =>
  a.year !== b.year ? a.year - b.year : a.month - b.month

const daysInMonth = (year: number, month: number): number =>
  [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export const periodStart = (p: Period): ISODate =>
  `${p.year}-${String(p.month).padStart(2, '0')}-01`

export const periodEnd = (p: Period): ISODate =>
  `${p.year}-${String(p.month).padStart(2, '0')}-${String(daysInMonth(p.year, p.month)).padStart(2, '0')}`

/** Add n months to a period (n may be negative). */
export const addMonths = (p: Period, n: number): Period => {
  const zero = p.year * 12 + (p.month - 1) + n
  return { year: Math.floor(zero / 12), month: (zero % 12 + 12) % 12 + 1 }
}

/** Shift an ISO date by n days (UTC arithmetic; no timezone drift). */
export const addDays = (date: ISODate, n: number): ISODate => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Fiscal quarter of a date for a company whose fiscal year ends in
 * `fiscalYearEndMonth` (12 = calendar year). Quarter 1 starts the month after
 * fiscal year end.
 */
export interface FiscalQuarter {
  /** The fiscal year is labeled by the calendar year the FY ends in. */
  readonly fiscalYear: number
  readonly quarter: 1 | 2 | 3 | 4
  readonly startDate: ISODate
  readonly endDate: ISODate
}

export const fiscalQuarterOf = (date: ISODate, fiscalYearEndMonth: number): FiscalQuarter => {
  const p = periodOfDate(date)
  // Months elapsed since the fiscal year started (0-11).
  const fyStartMonth = (fiscalYearEndMonth % 12) + 1
  const elapsed = (p.month - fyStartMonth + 12) % 12
  const quarter = (Math.floor(elapsed / 3) + 1) as 1 | 2 | 3 | 4
  const qStart = addMonths(p, -(elapsed % 3))
  const qEnd = addMonths(qStart, 2)
  const fyEnd = addMonths(qStart, 11 - elapsed + (elapsed % 3))
  return {
    fiscalYear: fyEnd.year,
    quarter,
    startDate: periodStart(qStart),
    endDate: periodEnd(qEnd),
  }
}
