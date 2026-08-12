import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { dataPort } from '../../data'
import { seedDemoData } from '../../seed/demoData'
import { SHEET_TYPE_LABELS, type SheetType } from '../../domain/sheets'
import { ErrorBoundary } from '../components/ErrorBoundary'
import {
  setSelectedCompany,
  useCompanies,
  useInvalidateCompany,
  useSelectedCompanyId,
} from '../state/company'

const SHEET_NAV: SheetType[] = [
  'sales_invoice',
  'sales_receipt',
  'purchase_bill',
  'collection',
  'disbursement',
  'general_journal',
  'payroll_register',
  'credit_memo',
  'debit_memo',
]

export function AppShell() {
  const companies = useCompanies()
  const selected = useSelectedCompanyId()
  const invalidate = useInvalidateCompany()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)

  const empty = companies.isSuccess && companies.data.length === 0
  useEffect(() => {
    if (companies.isSuccess && companies.data.length > 0) {
      const stillExists = companies.data.some((c) => c.id === selected)
      if (!selected || !stillExists) setSelectedCompany(companies.data[0]!.id)
    }
  }, [companies.isSuccess, companies.data, selected])

  // "?" anywhere outside an input opens the shortcut reference.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable) return
      if (e.key === '?') {
        e.preventDefault()
        setShortcuts((s) => !s)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const loadDemo = async () => {
    await seedDemoData(dataPort())
    const list = await dataPort().companies.list()
    if (list[0]) setSelectedCompany(list[0].id)
    list.forEach((c) => invalidate(c.id))
  }

  if (companies.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        Loading your books…
      </div>
    )
  }

  if (companies.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="mb-1 font-bold text-red-700">Could not open the local database</h1>
          <p className="text-sm text-red-600">{String(companies.error)}</p>
        </div>
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <h1 className="text-2xl font-bold">Welcome to PH Books</h1>
        <p className="max-w-md text-slate-600">
          No company here yet. Set one up from scratch, or load the three demo companies to see a
          VAT corporation, an 8% professional, and a percentage-tax store side by side.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => void navigate({ to: '/onboarding' })}
            className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            Set up a company
          </button>
          <button
            onClick={() => void loadDemo()}
            className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium hover:bg-white"
          >
            Load demo companies
          </button>
        </div>
      </div>
    )
  }

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-block h-7 w-7 rounded-lg bg-brand-600 text-center font-bold leading-7 text-white">
            ₱
          </span>
          <span className="font-semibold">PH Books</span>
        </Link>
        <select
          className="mt-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={selected ?? ''}
          onChange={(e) => setSelectedCompany(e.target.value)}
        >
          {(companies.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.businessStyle || c.registeredName}
            </option>
          ))}
        </select>
      </div>
      <nav className="flex-1 overflow-y-auto p-3 text-sm" onClick={() => setSidebarOpen(false)}>
        <NavLink to="/app" label="Dashboard & filing calendar" exact />
        <p className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sheets
        </p>
        {SHEET_NAV.map((t) => (
          <Link
            key={t}
            to="/app/sheets/$sheetType"
            params={{ sheetType: t }}
            className="block rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100"
            activeProps={{ className: 'block rounded-md px-2 py-1.5 bg-brand-50 text-brand-700 font-medium' }}
          >
            {SHEET_TYPE_LABELS[t]}
          </Link>
        ))}
        <p className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Output
        </p>
        <Link
          to="/app/ledger/$view"
          params={{ view: 'gl' }}
          className="block rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100"
          activeProps={{ className: 'block rounded-md px-2 py-1.5 bg-brand-50 text-brand-700 font-medium' }}
        >
          Ledgers & audit trail
        </Link>
        <NavLink to="/app/books" label="Books of accounts" />
        <NavLink to="/app/statements" label="Financial statements" />
        <NavLink to="/app/reports" label="Returns & filings" />
        <NavLink to="/app/close" label="Period close" />
        <p className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Setup
        </p>
        <Link
          to="/app/master/$section"
          params={{ section: 'parties' }}
          className="block rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100"
          activeProps={{ className: 'block rounded-md px-2 py-1.5 bg-brand-50 text-brand-700 font-medium' }}
        >
          Master data
        </Link>
        <NavLink to="/app/settings" label="Registration & settings" />
      </nav>
      <div className="border-t border-slate-100 p-3 text-sm">
        <Link to="/onboarding" className="block rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100">
          + New company
        </Link>
        <button
          onClick={() => setShortcuts(true)}
          className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-slate-500 hover:bg-slate-100"
        >
          Keyboard shortcuts <kbd className="ml-1 rounded border border-slate-300 bg-slate-50 px-1 text-xs">?</kbd>
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Static sidebar ≥ md; off-canvas below. */}
      <div className="hidden md:block">{sidebar}</div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      )}
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <button
          onClick={() => setSidebarOpen(true)}
          className="mb-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm md:hidden"
        >
          ☰ Menu
        </button>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
    </div>
  )
}

function ShortcutsModal({ onClose }: { onClose(): void }) {
  const rows: [string, string][] = [
    ['↑ ↓', 'Move between grid rows'],
    ['← →', 'Move between grid columns (from the text edge)'],
    ['Tab / Shift+Tab', 'Next / previous cell'],
    ['Enter', 'Commit the cell and move down (adds a row at the bottom)'],
    ['Ctrl/⌘ + Enter', 'Post the sheet to the ledger'],
    ['Ctrl/⌘ + V', 'Paste a block from Excel/Sheets into the grid'],
    ['?', 'Toggle this reference'],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([keys, what]) => (
              <tr key={keys} className="border-t border-slate-100">
                <td className="py-2 pr-4">
                  <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs">{keys}</kbd>
                </td>
                <td className="py-2 text-slate-600">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NavLink({ to, label, exact }: { to: string; label: string; exact?: boolean }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      className="block rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100"
      activeProps={{ className: 'block rounded-md px-2 py-1.5 bg-brand-50 text-brand-700 font-medium' }}
    >
      {label}
    </Link>
  )
}
