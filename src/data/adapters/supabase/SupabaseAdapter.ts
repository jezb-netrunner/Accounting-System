import type { DataPort } from '../../ports'

/**
 * SupabaseAdapter — deliberately a stub. The schema it will target is
 * already authored in supabase/migrations/0001_init.sql; when integration
 * lands, this file is the ONLY place that imports @supabase/supabase-js and
 * the only file that changes. Everything else talks to the DataPort.
 */

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `SupabaseAdapter.${method} is not implemented yet. ` +
        'Set VITE_DATA_ADAPTER=local, or implement this adapter (see ARCHITECTURE.md).',
    )
  }
}

const stub = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new NotImplementedError(`${name}.${String(prop)}`)
      }
    },
  })

export function createSupabaseAdapter(): DataPort {
  return {
    companies: stub('companies'),
    taxProfiles: stub('taxProfiles'),
    accounts: stub('accounts'),
    parties: stub('parties'),
    employees: stub('employees'),
    bankAccounts: stub('bankAccounts'),
    items: stub('items'),
    atcCodes: stub('atcCodes'),
    numbering: stub('numbering'),
    sheets: stub('sheets'),
    journal: stub('journal'),
    periodLocks: stub('periodLocks'),
  }
}
