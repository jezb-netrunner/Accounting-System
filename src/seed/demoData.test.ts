// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createLocalAdapter } from '../data/adapters/local/LocalAdapter'
import { trialBalance } from '../domain/ledger'
import { DEMO_COMPANY_IDS, seedDemoData } from './demoData'

describe('demo seed', () => {
  it('seeds three companies with posted, balanced ledgers — idempotently', async () => {
    const port = createLocalAdapter('seed-test-db')
    const first = await seedDemoData(port)
    expect(first.seeded).toHaveLength(3)

    for (const id of DEMO_COMPANY_IDS) {
      const entries = await port.journal.list(id)
      expect(entries.length).toBeGreaterThan(0)
      const accounts = await port.accounts.list(id)
      const tb = trialBalance(entries, accounts, '2026-12-31')
      expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true)
      const sheets = await port.sheets.list(id)
      expect(sheets.every((s) => s.status === 'posted')).toBe(true)
    }

    // VAT corp has output VAT; the non-VAT professional must not.
    const narra = await port.journal.list('demo-narra')
    expect(narra.some((e) => e.lines.some((l) => l.taxTag === 'output_vat'))).toBe(true)
    const reyes = await port.journal.list('demo-reyes')
    expect(reyes.some((e) => e.lines.some((l) => l.taxTag === 'output_vat'))).toBe(false)

    const second = await seedDemoData(port)
    expect(second.seeded).toHaveLength(0)
  })
})
