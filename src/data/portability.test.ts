import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createLocalAdapter } from './adapters/local/LocalAdapter'
import { exportCompany, importCompany, parseCompanyBundle } from './portability'
import { seedDemoData } from '../seed/demoData'

describe('company JSON portability', () => {
  it('round-trips a full company between two adapters', async () => {
    const source = createLocalAdapter('portability-src')
    await seedDemoData(source)

    const bundle = await exportCompany(source, 'demo-narra')
    const json = JSON.stringify(bundle)
    const parsed = parseCompanyBundle(json)

    const target = createLocalAdapter('portability-dst')
    const company = await importCompany(target, parsed)
    expect(company.registeredName).toBe('Narra Trading Corporation')

    // Everything moved: profile (with its Set restored), accounts, parties,
    // sheets, journal — and the ledger still ties.
    const profile = await target.taxProfiles.resolveAt('demo-narra', '2026-06-01')
    expect(profile?.registeredTaxTypes.has('vat')).toBe(true)

    const srcEntries = await source.journal.list('demo-narra')
    const dstEntries = await target.journal.list('demo-narra')
    expect(dstEntries).toHaveLength(srcEntries.length)
    const total = dstEntries.flatMap((e) => e.lines).reduce((a, l) => a + l.debitCentavos - l.creditCentavos, 0)
    expect(total).toBe(0)

    const sheets = await target.sheets.list('demo-narra')
    expect(sheets.every((s) => s.status === 'posted')).toBe(true)
    // Posted sheets stay immutable in the target too.
    await expect(target.sheets.deleteDraft(sheets[0]!.id)).rejects.toThrow(/posted/)
  })

  it('refuses to import over an existing company', async () => {
    const port = createLocalAdapter('portability-dup')
    await seedDemoData(port)
    const bundle = await exportCompany(port, 'demo-narra')
    await expect(importCompany(port, bundle)).rejects.toThrow(/already exists/)
  })

  it('rejects foreign JSON', () => {
    expect(() => parseCompanyBundle('{"foo": 1}')).toThrow(/Not a PH Books company export/)
  })
})
