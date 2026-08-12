import type { ISODate, TIN } from '../../domain/core'
import type { Money } from '../../lib/money'

/**
 * BIR electronic attachments are pipe-delimited .DAT files consumed by the
 * BIR validation modules (RELIEF for SLSP, the Alphalist Data Entry module
 * for QAP/SAWT/alphalists). Every writer sits behind this interface so the
 * exact field layouts (which BIR revises) stay in one implementation each.
 */

export interface DatFile {
  readonly filename: string
  readonly content: string
}

export interface DatFileWriter<T> {
  /** e.g. "SLSP", "QAP", "SAWT", "1604C_ALPHALIST" */
  readonly kind: string
  write(model: T): DatFile
}

export class DatWriterNotImplementedError extends Error {
  constructor(kind: string) {
    super(`${kind} .DAT writer not implemented yet — the typed model is the contract; field layout lands later`)
  }
}

// ---- Typed attachment models ----

export interface SlspRow {
  readonly counterpartyTin: TIN
  readonly registeredName: string
  readonly address: string
  readonly grossAmount: Money
  readonly exemptAmount: Money
  readonly zeroRatedAmount: Money
  readonly taxableNet: Money
  readonly vatAmount: Money
}

export interface SlspModel {
  readonly ownerTin: TIN
  readonly ownerName: string
  readonly periodFrom: ISODate
  readonly periodTo: ISODate
  readonly sales: readonly SlspRow[]
  readonly purchases: readonly SlspRow[]
}

export interface QapRow {
  readonly payeeTin: TIN
  readonly payeeName: string
  readonly atc: string
  readonly incomePayment: Money
  readonly ratePercent: number
  readonly taxWithheld: Money
}

export interface QapModel {
  readonly agentTin: TIN
  readonly agentName: string
  readonly quarterEnd: ISODate
  readonly kind: 'EQ' | 'FQ'
  readonly rows: readonly QapRow[]
}

export interface SawtRow {
  readonly payorTin: TIN
  readonly payorName: string
  readonly atc: string
  readonly incomePayment: Money
  readonly taxWithheld: Money
}

export interface SawtModel {
  readonly claimantTin: TIN
  readonly claimantName: string
  readonly returnPeriodEnd: ISODate
  readonly attachedToForm: string // '1701Q' | '1702Q' | ...
  readonly rows: readonly SawtRow[]
}

export interface AlphalistEmployeeRow {
  readonly tin: TIN
  readonly lastName: string
  readonly firstName: string
  readonly middleName: string
  readonly grossCompensation: Money
  readonly nonTaxable: Money
  readonly taxable: Money
  readonly taxWithheld: Money
  readonly employedFrom: ISODate
  readonly employedTo: ISODate | null
}

export interface AnnualAlphalistModel {
  readonly agentTin: TIN
  readonly agentName: string
  readonly year: number
  readonly variant: 'C' | 'E' | 'F'
  readonly employees: readonly AlphalistEmployeeRow[]
}

// ---- Writers ----
//
// Each writer reads its layout contract from docs/bir-formats/ (registered
// in formatSpecs.ts). While a format is UNVERIFIED the writer throws instead
// of guessing a layout eFPS would reject; the draft CSV writers below give
// reviewers the same data, clearly labeled as not-for-submission.

import { specFor, UnverifiedFormatError } from './formatSpecs'
import { formatTIN } from '../../domain/core'

const writeWhenVerified = <T>(kind: string): DatFileWriter<T> => ({
  kind,
  write(): DatFile {
    const spec = specFor(kind)
    if (!spec.verified) throw new UnverifiedFormatError(spec)
    // Unreachable until a spec is verified; the verified implementation
    // must read the layout from the spec file's tables.
    throw new DatWriterNotImplementedError(kind)
  },
})

export const slspWriter: DatFileWriter<SlspModel> = writeWhenVerified('SLSP')
export const qapWriter: DatFileWriter<QapModel> = writeWhenVerified('QAP')
export const sawtWriter: DatFileWriter<SawtModel> = writeWhenVerified('SAWT')
export const annualAlphalistWriter: DatFileWriter<AnnualAlphalistModel> =
  writeWhenVerified('ALPHALIST_1604C')

// ---- Draft CSV exports (review only, never for eFPS/eSubmission) ----

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const csvLine = (cells: readonly (string | number)[]) => cells.map((c) => csvEscape(String(c))).join(',')
const DRAFT_BANNER = 'DRAFT FOR REVIEW ONLY — NOT the BIR .DAT layout; do not submit to eFPS/eSubmission'

export function slspDraftCsv(model: SlspModel): DatFile {
  const lines = [
    csvLine([DRAFT_BANNER]),
    csvLine(['type', 'tin', 'registered name', 'address', 'gross', 'exempt', 'zero-rated', 'taxable net', 'vat']),
    ...model.sales.map((r) =>
      csvLine(['S', formatTIN(r.counterpartyTin), r.registeredName, r.address, r.grossAmount.format(), r.exemptAmount.format(), r.zeroRatedAmount.format(), r.taxableNet.format(), r.vatAmount.format()]),
    ),
    ...model.purchases.map((r) =>
      csvLine(['P', formatTIN(r.counterpartyTin), r.registeredName, r.address, r.grossAmount.format(), r.exemptAmount.format(), r.zeroRatedAmount.format(), r.taxableNet.format(), r.vatAmount.format()]),
    ),
  ]
  return { filename: `SLSP-draft-${model.periodTo}.csv`, content: lines.join('\r\n') }
}

export function qapDraftCsv(model: QapModel): DatFile {
  const lines = [
    csvLine([DRAFT_BANNER]),
    csvLine(['payee tin', 'payee name', 'atc', 'income payment', 'rate %', 'tax withheld']),
    ...model.rows.map((r) =>
      csvLine([formatTIN(r.payeeTin), r.payeeName, r.atc, r.incomePayment.format(), r.ratePercent, r.taxWithheld.format()]),
    ),
  ]
  return { filename: `QAP-${model.kind}-draft-${model.quarterEnd}.csv`, content: lines.join('\r\n') }
}

export function sawtDraftCsv(model: SawtModel): DatFile {
  const lines = [
    csvLine([DRAFT_BANNER]),
    csvLine(['payor tin', 'payor name', 'atc', 'income payment', 'tax withheld']),
    ...model.rows.map((r) =>
      csvLine([formatTIN(r.payorTin), r.payorName, r.atc, r.incomePayment.format(), r.taxWithheld.format()]),
    ),
  ]
  return { filename: `SAWT-draft-${model.returnPeriodEnd}.csv`, content: lines.join('\r\n') }
}

export function alphalistDraftCsv(model: AnnualAlphalistModel): DatFile {
  const lines = [
    csvLine([DRAFT_BANNER]),
    csvLine(['tin', 'last name', 'first name', 'middle name', 'gross', 'non-taxable', 'taxable', 'tax withheld', 'from', 'to']),
    ...model.employees.map((r) =>
      csvLine([formatTIN(r.tin), r.lastName, r.firstName, r.middleName, r.grossCompensation.format(), r.nonTaxable.format(), r.taxable.format(), r.taxWithheld.format(), r.employedFrom, r.employedTo ?? '']),
    ),
  ]
  return { filename: `1604${model.variant}-alphalist-draft-${model.year}.csv`, content: lines.join('\r\n') }
}
