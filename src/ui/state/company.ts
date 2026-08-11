import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { dataPort } from '../../data'

/** Selected company: tiny external store persisted to localStorage. */
const KEY = 'ph-books:selected-company'
let listeners: Array<() => void> = []

const getSnapshot = () => localStorage.getItem(KEY)

export function setSelectedCompany(id: string) {
  localStorage.setItem(KEY, id)
  listeners.forEach((l) => l())
}

export function useSelectedCompanyId(): string | null {
  return useSyncExternalStore(
    useCallback((cb) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    }, []),
    getSnapshot,
  )
}

export function useCompanies() {
  return useQuery({ queryKey: ['companies'], queryFn: () => dataPort().companies.list() })
}

export function useCompanyData(companyId: string | null) {
  const enabled = companyId !== null
  const accounts = useQuery({
    queryKey: ['accounts', companyId],
    queryFn: () => dataPort().accounts.list(companyId!),
    enabled,
  })
  const profile = useQuery({
    queryKey: ['profile', companyId],
    queryFn: () => dataPort().taxProfiles.resolveAt(companyId!, new Date().toISOString().slice(0, 10)),
    enabled,
  })
  const parties = useQuery({
    queryKey: ['parties', companyId],
    queryFn: () => dataPort().parties.list(companyId!),
    enabled,
  })
  const entries = useQuery({
    queryKey: ['journal', companyId],
    queryFn: () => dataPort().journal.list(companyId!),
    enabled,
  })
  const sheets = useQuery({
    queryKey: ['sheets', companyId],
    queryFn: () => dataPort().sheets.list(companyId!),
    enabled,
  })
  const locks = useQuery({
    queryKey: ['locks', companyId],
    queryFn: () => dataPort().periodLocks.list(companyId!),
    enabled,
  })
  return { accounts, profile, parties, entries, sheets, locks }
}

export function useInvalidateCompany() {
  const qc = useQueryClient()
  return (companyId: string) => {
    for (const key of ['accounts', 'profile', 'parties', 'journal', 'sheets', 'locks']) {
      void qc.invalidateQueries({ queryKey: [key, companyId] })
    }
    void qc.invalidateQueries({ queryKey: ['companies'] })
  }
}
