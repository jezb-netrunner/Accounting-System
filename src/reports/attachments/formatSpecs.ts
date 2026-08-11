/**
 * Registry of BIR electronic file formats and their verification status.
 *
 * The writers REFUSE to emit a submission file until the format's field
 * layout has been verified against an authoritative source (the BIR
 * validation module's documentation or a known-accepted sample). Guessing a
 * pipe-delimited layout produces files eFPS/eSubmission rejects — flagging
 * loudly beats inventing silently. Each entry points at the checked-in spec
 * under docs/bir-formats/ that a maintainer completes to flip `verified`.
 */

export interface DatFormatSpec {
  readonly kind: string
  readonly name: string
  /** Checked-in spec the writer reads its layout contract from. */
  readonly specFile: string
  /** False until the authoritative field order/widths/delimiters are supplied. */
  readonly verified: boolean
  readonly notes: string
}

export const FORMAT_SPECS: Readonly<Record<string, DatFormatSpec>> = {
  SLSP: {
    kind: 'SLSP',
    name: 'Summary List of Sales and Purchases (RELIEF .DAT)',
    specFile: 'docs/bir-formats/slsp-dat.md',
    verified: false,
    notes: 'Header/detail record layouts for the RELIEF data entry & validation module.',
  },
  QAP: {
    kind: 'QAP',
    name: 'Quarterly Alphalist of Payees (.DAT)',
    specFile: 'docs/bir-formats/qap-dat.md',
    verified: false,
    notes: 'Alphalist Data Entry / eSubmission layout for 1601-EQ/FQ attachments.',
  },
  SAWT: {
    kind: 'SAWT',
    name: 'Summary Alphalist of Withholding Taxes (.DAT)',
    specFile: 'docs/bir-formats/sawt-dat.md',
    verified: false,
    notes: 'Attachment to income tax and VAT returns claiming creditable withholding.',
  },
  ALPHALIST_1604C: {
    kind: 'ALPHALIST_1604C',
    name: 'Annual Alphalist of Employees (1604-C .DAT)',
    specFile: 'docs/bir-formats/alphalist-1604c-dat.md',
    verified: false,
    notes: 'Schedules 1/2 employee alphalist for the annual compensation return.',
  },
  ALPHALIST_1604E: {
    kind: 'ALPHALIST_1604E',
    name: 'Annual Alphalist of Payees (1604-E .DAT)',
    specFile: 'docs/bir-formats/alphalist-1604e-dat.md',
    verified: false,
    notes: 'Annual EWT payee alphalist.',
  },
  ALPHALIST_1604F: {
    kind: 'ALPHALIST_1604F',
    name: 'Annual Alphalist (1604-F .DAT)',
    specFile: 'docs/bir-formats/alphalist-1604f-dat.md',
    verified: false,
    notes: 'Annual final-withholding alphalist.',
  },
  EBIRFORMS_XML: {
    kind: 'EBIRFORMS_XML',
    name: 'eBIRForms package XML',
    specFile: 'docs/bir-formats/ebirforms-xml.md',
    verified: false,
    notes: 'Per-form XML field ids consumed by the offline eBIRForms package.',
  },
}

export class UnverifiedFormatError extends Error {
  constructor(spec: DatFormatSpec) {
    super(
      `${spec.name}: the file layout is UNVERIFIED. This writer refuses to guess a format that ` +
        `eFPS/eSubmission would reject. Supply the authoritative field order, widths, and ` +
        `delimiters in ${spec.specFile} (and flip verified: true in formatSpecs.ts). ` +
        `A clearly-labeled draft CSV of the same data is available for review.`,
    )
  }
}

export const specFor = (kind: string): DatFormatSpec => {
  const spec = FORMAT_SPECS[kind]
  if (!spec) throw new Error(`Unknown format kind "${kind}"`)
  return spec
}
