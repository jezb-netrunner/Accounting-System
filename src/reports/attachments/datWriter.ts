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

// ---- Stub writers (typed pipeline wired; layouts pending) ----

export const slspWriter: DatFileWriter<SlspModel> = {
  kind: 'SLSP',
  write() {
    throw new DatWriterNotImplementedError('SLSP')
  },
}

export const qapWriter: DatFileWriter<QapModel> = {
  kind: 'QAP',
  write() {
    throw new DatWriterNotImplementedError('QAP')
  },
}

export const sawtWriter: DatFileWriter<SawtModel> = {
  kind: 'SAWT',
  write() {
    throw new DatWriterNotImplementedError('SAWT')
  },
}

export const annualAlphalistWriter: DatFileWriter<AnnualAlphalistModel> = {
  kind: 'ANNUAL_ALPHALIST',
  write() {
    throw new DatWriterNotImplementedError('ANNUAL_ALPHALIST')
  },
}
