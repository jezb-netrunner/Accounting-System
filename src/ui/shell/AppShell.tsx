import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { dataPort } from '../../data'
import { seedDemoData } from '../../seed/demoData'
import { SHEET_TYPE_LABELS, type SheetType } from '../../domain/sheets'
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

  // First launch: no companies yet → offer demo data or onboarding.
  const empty = companies.isSuccess && companies.data.length === 0
  useEffect(() => {
    if (companies.isSuccess && companies.data.length > 0 && !selected) {
      setSelectedCompany(companies.data[0]!.id)
    }
  }, [companies.isSuccess, companies.data, selected])

  const loadDemo = async () => {
    await seedDemoData(dataPort())
    const list = await dataPort().companies.list()
    if (list[0]) setSelectedCompany(list[0].id)
    list.forEach((c) => invalidate(c.id))
  }

  if (empty) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <h1 className="text-2xl font-bold">Welcome to PH Books</h1>
        <p className="max-w-md text-slate-600">
          No company here yet. Set one up from scratch, or load the three demo
          companies to see a VAT corporation, an 8% professional, and a
          percentage-tax store side by side.
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

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
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
        <nav className="flex-1 overflow-y-auto p-3 text-sm">
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
          <NavLink to="/app/reports" label="Books, statements & returns" />
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
        <div className="border-t border-slate-100 p-3">
          <Link to="/onboarding" className="block rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            + New company
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
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
