import { describe, expect, it } from 'vitest'
import { autoMapColumns, dryRunImport, parseDelimited } from './importer'
import { PARTY_IMPORT_SPEC } from './importSpecs'
import { validateTinString } from './validation'

describe('parseDelimited', () => {
  it('parses pasted TSV (Excel clipboard shape)', () => {
    const t = parseDelimited('Name\tTIN\nAcme Corp\t123456789\nBeta Inc\t987654321')
    expect(t.headers).toEqual(['Name', 'TIN'])
    expect(t.rows).toEqual([
      ['Acme Corp', '123456789'],
      ['Beta Inc', '987654321'],
    ])
  })

  it('parses CSV with quoted fields, embedded commas and escaped quotes', () => {
    const t = parseDelimited('name,address\n"Reyes, Bea","Unit 5, ""The Tower"", QC"')
    expect(t.headers).toEqual(['name', 'address'])
    expect(t.rows[0]).toEqual(['Reyes, Bea', 'Unit 5, "The Tower", QC'])
  })

  it('prefers tabs when both delimiters appear (pasted from Excel)', () => {
    const t = parseDelimited('name\taddress\nAcme, Inc.\tMakati')
    expect(t.rows[0]).toEqual(['Acme, Inc.', 'Makati'])
  })

  it('skips blank lines and handles CRLF', () => {
    const t = parseDelimited('a,b\r\n1,2\r\n\r\n3,4\r\n')
    expect(t.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })
})

describe('validateTinString', () => {
  it('accepts dashed and undashed TINs, with and without branch codes', () => {
    expect(validateTinString('123-456-789-000')).toEqual({ base: '123456789', branchCode: '000' })
    expect(validateTinString('123456789')).toEqual({ base: '123456789', branchCode: '000' })
    expect(validateTinString('123456789-00001')).toEqual({ base: '123456789', branchCode: '00001' })
    expect(validateTinString(' 123 456 789 ')).toEqual({ base: '123456789', branchCode: '000' })
  })

  it('rejects wrong lengths and characters', () => {
    expect(() => validateTinString('12345678')).toThrow(/9 digits/)
    expect(() => validateTinString('123456789-12')).toThrow(/branch/i)
    expect(() => validateTinString('abcdefghi')).toThrow(/9 digits/)
  })
})

describe('autoMapColumns', () => {
  it('fuzzy-matches pasted headers onto the spec', () => {
    const mapping = autoMapColumns(PARTY_IMPORT_SPEC, [
      'Registered Name',
      'TIN No.',
      'Address',
      'Customer or Supplier',
    ])
    expect(mapping['registeredName']).toBe(0)
    expect(mapping['tin']).toBe(1)
    expect(mapping['address']).toBe(2)
    expect(mapping['role']).toBe(3)
  })
})

describe('dryRunImport (parties)', () => {
  const table = parseDelimited(
    [
      'name\ttin\trole\tclass',
      'Acme Corp\t123-456-789-000\tcustomer\tcorporation',
      'Bad TIN Co\t12345\tsupplier\tcorporation',
      '\t222333444\tcustomer\tindividual',
      'Both Ways Trading\t555666777\tboth\tcorporation',
    ].join('\n'),
  )
  const mapping = {
    registeredName: 0,
    tin: 1,
    role: 2,
    payeeClass: 3,
  }

  it('reports per-row errors with the offending column and keeps valid rows', () => {
    const r = dryRunImport(PARTY_IMPORT_SPEC, table, mapping, { companyId: 'co-1' })
    expect(r.total).toBe(4)
    expect(r.valid).toHaveLength(2)
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toMatchObject({ row: 2, column: 'tin' })
    expect(r.errors[1]).toMatchObject({ row: 3, column: 'registeredName' })
  })

  it('builds fully-formed entities from valid rows', () => {
    const r = dryRunImport(PARTY_IMPORT_SPEC, table, mapping, { companyId: 'co-1' })
    const acme = r.valid[0]!
    expect(acme.companyId).toBe('co-1')
    expect(acme.registeredName).toBe('Acme Corp')
    expect(acme.tin).toEqual({ base: '123456789', branchCode: '000' })
    expect(acme.isCustomer).toBe(true)
    expect(acme.isSupplier).toBe(false)
    const both = r.valid[1]!
    expect(both.isCustomer).toBe(true)
    expect(both.isSupplier).toBe(true)
  })

  it('fails rows when a required column is unmapped', () => {
    const r = dryRunImport(PARTY_IMPORT_SPEC, table, { registeredName: 0 }, { companyId: 'co-1' })
    expect(r.valid).toHaveLength(0)
    expect(r.errors).toHaveLength(4)
    // Rows with a name fail on the missing TIN; the blank-name row fails first on the name.
    expect(r.errors.filter((e) => e.column === 'tin')).toHaveLength(3)
    expect(r.errors.filter((e) => e.column === 'registeredName')).toHaveLength(1)
  })
})
