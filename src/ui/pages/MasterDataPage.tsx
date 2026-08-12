import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { dataPort } from '../../data'
import { formatTIN, tin as makeTin } from '../../domain/core'
import type { ImportSpec } from '../../domain/importer'
import {
  ATC_IMPORT_SPEC,
  BANK_ACCOUNT_IMPORT_SPEC,
  EMPLOYEE_IMPORT_SPEC,
  ITEM_IMPORT_SPEC,
  PARTY_IMPORT_SPEC,
  type ImportCtx,
} from '../../domain/importSpecs'
import {
  referencedEmployeeIds,
  referencedItemIds,
  referencedPartyIds,
  type AtcCode,
  type BankAccount,
  type Employee,
  type Item,
  type NumberingSeries,
  type Party,
} from '../../domain/masterData'
import { validateTinString } from '../../domain/validation'
import { Money } from '../../lib/money'
import { rules } from '../../tax/rules'
import { ImportDialog } from '../master/ImportDialog'
import { useCompanyData, useSelectedCompanyId } from '../state/company'

/**
 * Master data: full CRUD with validation for customers/suppliers, employees,
 * bank accounts, items, ATC codes, and numbering series. Records referenced
 * by any sheet can only be merged or deactivated — never hard-deleted.
 */

export type MasterSection = 'parties' | 'employees' | 'banks' | 'items' | 'atc' | 'numbering'

const SECTIONS: { key: MasterSection; label: string }[] = [
  { key: 'parties', label: 'Customers & suppliers' },
  { key: 'employees', label: 'Employees' },
  { key: 'banks', label: 'Bank accounts' },
  { key: 'items', label: 'Items & services' },
  { key: 'atc', label: 'ATC codes' },
  { key: 'numbering', label: 'Numbering series' },
]

export function MasterDataPage() {
  const { section } = useParams({ from: '/app/master/$section' }) as { section: MasterSection }
  const companyId = useSelectedCompanyId()

  if (!companyId) return <p className="text-slate-500">Select a company.</p>

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Master data</h1>
        <p className="text-sm text-slate-500">
          Anything referenced by a posted entry can be merged or deactivated, never deleted.
        </p>
      </header>
      <nav className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to="/app/master/$section"
            params={{ section: s.key }}
            className={`rounded-full px-3 py-1.5 text-sm ${
              s.key === section
                ? 'bg-brand-600 font-medium text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {section === 'parties' && <PartiesSection companyId={companyId} />}
      {section === 'employees' && <EmployeesSection companyId={companyId} />}
      {section === 'banks' && <BanksSection companyId={companyId} />}
      {section === 'items' && <ItemsSection companyId={companyId} />}
      {section === 'atc' && <AtcSection companyId={companyId} />}
      {section === 'numbering' && <NumberingSection companyId={companyId} />}
    </div>
  )
}

function useMasterList<T>(key: string, companyId: string, fetch: () => Promise<T[]>) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: [key, companyId], queryFn: fetch })
  return { ...q, refresh: () => void qc.invalidateQueries({ queryKey: [key, companyId] }) }
}

function SectionShell({
  title,
  onNew,
  onImport,
  children,
}: {
  title: string
  onNew?: () => void
  onImport?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex gap-2">
          {onImport && (
            <button onClick={onImport} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              Import…
            </button>
          )}
          {onNew && (
            <button onClick={onNew} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              + New
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function EmptyRow({ span, label }: { span: number; label: string }) {
  return (
    <tr>
      <td colSpan={span} className="px-2 py-6 text-center text-slate-400">
        {label}
      </td>
    </tr>
  )
}

function RowActions({
  active,
  referenced,
  onEdit,
  onToggleActive,
  onDelete,
  extra,
}: {
  active: boolean
  referenced: boolean
  onEdit(): void
  onToggleActive(): void
  onDelete(): void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex justify-end gap-2 text-xs">
      {extra}
      <button onClick={onEdit} className="text-brand-600 hover:underline">Edit</button>
      <button onClick={onToggleActive} className="text-slate-500 hover:underline">
        {active ? 'Deactivate' : 'Reactivate'}
      </button>
      {referenced ? (
        <span className="cursor-not-allowed text-slate-300" title="Referenced by documents — deactivate or merge instead">
          Delete
        </span>
      ) : (
        <button onClick={onDelete} className="text-red-500 hover:underline">Delete</button>
      )}
    </div>
  )
}

const Modal = ({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
    <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      {children}
    </div>
  </div>
)

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium">{label}</span>
    {children}
  </label>
)

// ---------------- Parties ----------------

function PartiesSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('parties', companyId, () => dataPort().parties.list(companyId))
  const { sheets } = useCompanyData(companyId)
  const referenced = useMemo(() => referencedPartyIds(sheets.data ?? []), [sheets.data])
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [merging, setMerging] = useState<Party | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (p: Party) => {
    await dataPort().parties.save(p)
    refresh()
    setEditing(null)
  }

  const parties = (data ?? []).filter((p) => !p.mergedIntoId)

  return (
    <SectionShell title="Customers & suppliers" onNew={() => setEditing('new')} onImport={() => setImporting(true)}>
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <Table headers={['Name', 'TIN', 'Roles', 'Class', 'Default ATC', 'Status', '']}>
        {parties.length === 0 && <EmptyRow span={7} label="No customers or suppliers yet — add one or import from a spreadsheet." />}
        {parties.map((p) => (
          <tr key={p.id} className={`border-t border-slate-100 ${p.active ? '' : 'opacity-50'}`}>
            <td className="px-2 py-1.5 font-medium">
              {p.registeredName}
              {p.isGovernment && <span className="ml-1.5 rounded bg-amber-50 px-1.5 text-xs text-amber-700">gov</span>}
            </td>
            <td className="px-2 py-1.5 tabular-nums">{formatTIN(p.tin)}</td>
            <td className="px-2 py-1.5 text-xs text-slate-500">
              {[p.isCustomer && 'customer', p.isSupplier && 'supplier'].filter(Boolean).join(' · ') || '—'}
            </td>
            <td className="px-2 py-1.5 text-xs">{p.payeeClass}</td>
            <td className="px-2 py-1.5 text-xs">{p.defaultAtc ?? '—'}</td>
            <td className="px-2 py-1.5 text-xs">{p.active ? 'active' : 'inactive'}</td>
            <td className="px-2 py-1.5">
              <RowActions
                active={p.active}
                referenced={referenced.has(p.id)}
                onEdit={() => setEditing(p)}
                onToggleActive={() => void save({ ...p, active: !p.active })}
                onDelete={() => {
                  void dataPort().parties.delete(p.id).then(refresh)
                }}
                extra={
                  <button onClick={() => setMerging(p)} className="text-slate-500 hover:underline">
                    Merge…
                  </button>
                }
              />
            </td>
          </tr>
        ))}
      </Table>

      {editing && (
        <PartyForm
          companyId={companyId}
          initial={editing === 'new' ? null : editing}
          onSave={(p) => void save(p).catch((e) => setError(String(e)))}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportDialog
          spec={PARTY_IMPORT_SPEC}
          companyId={companyId}
          onImport={async (rows) => {
            for (const r of rows) await dataPort().parties.save(r)
            refresh()
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {merging && (
        <Modal title={`Merge "${merging.registeredName}" into…`} onClose={() => setMerging(null)}>
          <p className="text-sm text-slate-500">
            The merged record is deactivated and points at the survivor; documents that referenced
            it keep their history and resolve through the merge.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {parties
              .filter((p) => p.id !== merging.id)
              .map((p) => (
                <button
                  key={p.id}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    void dataPort()
                      .parties.save({ ...merging, active: false, mergedIntoId: p.id })
                      .then(() => {
                        refresh()
                        setMerging(null)
                      })
                  }}
                >
                  {p.registeredName} <span className="text-xs text-slate-400">{formatTIN(p.tin)}</span>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </SectionShell>
  )
}

function PartyForm({
  companyId,
  initial,
  onSave,
  onClose,
}: {
  companyId: string
  initial: Party | null
  onSave(p: Party): void
  onClose(): void
}) {
  const [f, setF] = useState({
    registeredName: initial?.registeredName ?? '',
    tin: initial ? formatTIN(initial.tin) : '',
    businessStyle: initial?.businessStyle ?? '',
    registeredAddress: initial?.registeredAddress ?? '',
    zipCode: initial?.zipCode ?? '',
    isCustomer: initial?.isCustomer ?? true,
    isSupplier: initial?.isSupplier ?? false,
    payeeClass: initial?.payeeClass ?? ('corporation' as const),
    isGovernment: initial?.isGovernment ?? false,
    defaultAtc: initial?.defaultAtc ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const atcOptions = rules.withholding(today).atcRates

  const submit = () => {
    try {
      if (!f.registeredName.trim()) throw new Error('Registered name is required')
      if (!f.isCustomer && !f.isSupplier) throw new Error('Pick at least one role')
      const tin = validateTinString(f.tin)
      onSave({
        id: initial?.id ?? `${companyId}:party:${tin.base}-${tin.branchCode}-${Date.now()}`,
        companyId,
        tin: makeTin(tin.base, tin.branchCode),
        registeredName: f.registeredName.trim(),
        businessStyle: f.businessStyle,
        registeredAddress: f.registeredAddress,
        ...(f.zipCode ? { zipCode: f.zipCode } : {}),
        isCustomer: f.isCustomer,
        isSupplier: f.isSupplier,
        payeeClass: f.payeeClass,
        isGovernment: f.isGovernment,
        defaultAtc: f.defaultAtc || null,
        mergedIntoId: initial?.mergedIntoId ?? null,
        active: initial?.active ?? true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={initial ? 'Edit party' : 'New customer / supplier'} onClose={onClose}>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <L label="Registered name">
        <input className="input" value={f.registeredName} onChange={(e) => setF({ ...f, registeredName: e.target.value })} />
      </L>
      <div className="grid grid-cols-2 gap-3">
        <L label="TIN (with branch code)">
          <input className="input" placeholder="123-456-789-000" value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} />
        </L>
        <L label="Business style">
          <input className="input" value={f.businessStyle} onChange={(e) => setF({ ...f, businessStyle: e.target.value })} />
        </L>
      </div>
      <L label="Registered address">
        <input className="input" value={f.registeredAddress} onChange={(e) => setF({ ...f, registeredAddress: e.target.value })} />
      </L>
      <div className="grid grid-cols-3 gap-3">
        <L label="ZIP">
          <input className="input" value={f.zipCode} onChange={(e) => setF({ ...f, zipCode: e.target.value })} />
        </L>
        <L label="Payee class">
          <select
            className="input"
            value={f.payeeClass}
            onChange={(e) => setF({ ...f, payeeClass: e.target.value as 'individual' | 'corporation' })}
          >
            <option value="corporation">Corporation</option>
            <option value="individual">Individual</option>
          </select>
        </L>
        <L label="Default ATC (purchases)">
          <select className="input" value={f.defaultAtc} onChange={(e) => setF({ ...f, defaultAtc: e.target.value })}>
            <option value="">—</option>
            {atcOptions
              .filter((a) => a.payeeClass === f.payeeClass)
              .map((a) => (
                <option key={a.atc} value={a.atc}>
                  {a.atc} — {a.natureOfPayment}
                </option>
              ))}
          </select>
        </L>
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.isCustomer} onChange={(e) => setF({ ...f, isCustomer: e.target.checked })} className="accent-brand-600" />
          Customer
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.isSupplier} onChange={(e) => setF({ ...f, isSupplier: e.target.checked })} className="accent-brand-600" />
          Supplier
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.isGovernment} onChange={(e) => setF({ ...f, isGovernment: e.target.checked })} className="accent-brand-600" />
          Government / GOCC
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Save</button>
      </div>
    </Modal>
  )
}

// ---------------- Employees ----------------

function EmployeesSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('employees', companyId, () => dataPort().employees.list(companyId))
  const { sheets } = useCompanyData(companyId)
  const referenced = useMemo(() => referencedEmployeeIds(sheets.data ?? []), [sheets.data])
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const save = async (e: Employee) => {
    await dataPort().employees.save(e)
    refresh()
    setEditing(null)
  }

  return (
    <SectionShell title="Employees" onNew={() => setEditing('new')} onImport={() => setImporting(true)}>
      <Table headers={['No.', 'Name', 'TIN', 'Monthly basic', 'Hired', 'Status', '']}>
        {(data ?? []).length === 0 && <EmptyRow span={7} label="No employees yet." />}
        {(data ?? []).map((e) => (
          <tr key={e.id} className={`border-t border-slate-100 ${e.active ? '' : 'opacity-50'}`}>
            <td className="px-2 py-1.5">{e.employeeNo}</td>
            <td className="px-2 py-1.5 font-medium">{e.lastName}, {e.firstName}</td>
            <td className="px-2 py-1.5 tabular-nums">{formatTIN(e.tin)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{Money.fromCentavos(e.monthlyBasicPayCentavos).format()}</td>
            <td className="px-2 py-1.5 text-xs">{e.hireDate}</td>
            <td className="px-2 py-1.5 text-xs">{e.active ? 'active' : 'inactive'}</td>
            <td className="px-2 py-1.5">
              <RowActions
                active={e.active}
                referenced={referenced.has(e.id)}
                onEdit={() => setEditing(e)}
                onToggleActive={() => void save({ ...e, active: !e.active })}
                onDelete={() => void dataPort().employees.delete(e.id).then(refresh)}
              />
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <EmployeeForm
          companyId={companyId}
          initial={editing === 'new' ? null : editing}
          onSave={(e) => void save(e)}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportDialog
          spec={EMPLOYEE_IMPORT_SPEC}
          companyId={companyId}
          onImport={async (rows) => {
            for (const r of rows) await dataPort().employees.save(r)
            refresh()
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </SectionShell>
  )
}

function EmployeeForm({
  companyId,
  initial,
  onSave,
  onClose,
}: {
  companyId: string
  initial: Employee | null
  onSave(e: Employee): void
  onClose(): void
}) {
  const [f, setF] = useState({
    employeeNo: initial?.employeeNo ?? '',
    lastName: initial?.lastName ?? '',
    firstName: initial?.firstName ?? '',
    middleName: initial?.middleName ?? '',
    tin: initial ? formatTIN(initial.tin) : '',
    monthlyPay: initial ? Money.fromCentavos(initial.monthlyBasicPayCentavos).format().replace(/,/g, '') : '',
    hireDate: initial?.hireDate ?? new Date().toISOString().slice(0, 10),
    address: initial?.registeredAddress ?? '',
    sssNo: initial?.sssNo ?? '',
    philhealthNo: initial?.philhealthNo ?? '',
    pagibigNo: initial?.pagibigNo ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    try {
      if (!f.employeeNo.trim()) throw new Error('Employee number is required')
      if (!f.lastName.trim() || !f.firstName.trim()) throw new Error('Name is required')
      const tin = validateTinString(f.tin)
      const pay = Money.parse(f.monthlyPay || '0')
      onSave({
        id: initial?.id ?? `${companyId}:emp:${f.employeeNo.trim()}`,
        companyId,
        employeeNo: f.employeeNo.trim(),
        tin: makeTin(tin.base, tin.branchCode),
        registeredName: `${f.lastName}, ${f.firstName}${f.middleName ? ` ${f.middleName}` : ''}`,
        businessStyle: '',
        registeredAddress: f.address,
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        middleName: f.middleName || null,
        hireDate: f.hireDate,
        separationDate: initial?.separationDate ?? null,
        monthlyBasicPayCentavos: pay.centavos,
        sssNo: f.sssNo || null,
        philhealthNo: f.philhealthNo || null,
        pagibigNo: f.pagibigNo || null,
        active: initial?.active ?? true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={initial ? 'Edit employee' : 'New employee'} onClose={onClose}>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        <L label="Employee no.">
          <input className="input" value={f.employeeNo} onChange={(e) => setF({ ...f, employeeNo: e.target.value })} />
        </L>
        <L label="Last name">
          <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </L>
        <L label="First name">
          <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </L>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <L label="Middle name">
          <input className="input" value={f.middleName} onChange={(e) => setF({ ...f, middleName: e.target.value })} />
        </L>
        <L label="TIN">
          <input className="input" placeholder="123-456-789-000" value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} />
        </L>
        <L label="Monthly basic pay (₱)">
          <input className="input" inputMode="decimal" value={f.monthlyPay} onChange={(e) => setF({ ...f, monthlyPay: e.target.value })} />
        </L>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <L label="Hire date">
          <input type="date" className="input" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} />
        </L>
        <L label="Address">
          <input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </L>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <L label="SSS no.">
          <input className="input" value={f.sssNo} onChange={(e) => setF({ ...f, sssNo: e.target.value })} />
        </L>
        <L label="PhilHealth no.">
          <input className="input" value={f.philhealthNo} onChange={(e) => setF({ ...f, philhealthNo: e.target.value })} />
        </L>
        <L label="Pag-IBIG no.">
          <input className="input" value={f.pagibigNo} onChange={(e) => setF({ ...f, pagibigNo: e.target.value })} />
        </L>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Save</button>
      </div>
    </Modal>
  )
}

// ---------------- Bank accounts ----------------

function BanksSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('bankAccounts', companyId, () => dataPort().bankAccounts.list(companyId))
  const { sheets, accounts } = useCompanyData(companyId)
  const referencedCodes = useMemo(
    () => new Set((sheets.data ?? []).map((s) => s.bankAccountCode).filter(Boolean)),
    [sheets.data],
  )
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const save = async (b: BankAccount) => {
    await dataPort().bankAccounts.save(b)
    refresh()
    setEditing(null)
  }

  return (
    <SectionShell title="Bank accounts" onNew={() => setEditing('new')} onImport={() => setImporting(true)}>
      <Table headers={['Bank', 'Account name', 'Account no.', 'GL account', 'Status', '']}>
        {(data ?? []).length === 0 && <EmptyRow span={6} label="No bank accounts yet." />}
        {(data ?? []).map((b) => (
          <tr key={b.id} className={`border-t border-slate-100 ${b.active ? '' : 'opacity-50'}`}>
            <td className="px-2 py-1.5 font-medium">{b.bankName}</td>
            <td className="px-2 py-1.5">{b.accountName}</td>
            <td className="px-2 py-1.5 tabular-nums">{b.accountNo}</td>
            <td className="px-2 py-1.5 text-xs">{b.glAccountCode}</td>
            <td className="px-2 py-1.5 text-xs">{b.active ? 'active' : 'inactive'}</td>
            <td className="px-2 py-1.5">
              <RowActions
                active={b.active}
                referenced={referencedCodes.has(b.glAccountCode)}
                onEdit={() => setEditing(b)}
                onToggleActive={() => void save({ ...b, active: !b.active })}
                onDelete={() => void dataPort().bankAccounts.delete(b.id).then(refresh)}
              />
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <BankForm
          companyId={companyId}
          initial={editing === 'new' ? null : editing}
          accountOptions={(accounts.data ?? []).filter((a) => a.postable && a.type === 'asset')}
          onSave={(b) => void save(b)}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportDialog
          spec={BANK_ACCOUNT_IMPORT_SPEC}
          companyId={companyId}
          onImport={async (rows) => {
            for (const r of rows) await dataPort().bankAccounts.save(r)
            refresh()
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </SectionShell>
  )
}

function BankForm({
  companyId,
  initial,
  accountOptions,
  onSave,
  onClose,
}: {
  companyId: string
  initial: BankAccount | null
  accountOptions: { code: string; name: string }[]
  onSave(b: BankAccount): void
  onClose(): void
}) {
  const [f, setF] = useState({
    bankName: initial?.bankName ?? '',
    accountName: initial?.accountName ?? '',
    accountNo: initial?.accountNo ?? '',
    glAccountCode: initial?.glAccountCode ?? '1110',
  })
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (!f.bankName.trim() || !f.accountName.trim() || !f.accountNo.trim()) {
      setError('Bank, account name, and account number are required')
      return
    }
    onSave({
      id: initial?.id ?? `${companyId}:bank:${f.accountNo.trim()}`,
      companyId,
      bankName: f.bankName.trim(),
      accountName: f.accountName.trim(),
      accountNo: f.accountNo.trim(),
      glAccountCode: f.glAccountCode,
      active: initial?.active ?? true,
    })
  }
  return (
    <Modal title={initial ? 'Edit bank account' : 'New bank account'} onClose={onClose}>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <L label="Bank">
          <input className="input" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
        </L>
        <L label="Account name">
          <input className="input" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
        </L>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <L label="Account no.">
          <input className="input" value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} />
        </L>
        <L label="GL account">
          <select className="input" value={f.glAccountCode} onChange={(e) => setF({ ...f, glAccountCode: e.target.value })}>
            {accountOptions.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </L>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Save</button>
      </div>
    </Modal>
  )
}

// ---------------- Items ----------------

function ItemsSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('items', companyId, () => dataPort().items.list(companyId))
  const { sheets, accounts } = useCompanyData(companyId)
  const referenced = useMemo(() => referencedItemIds(sheets.data ?? []), [sheets.data])
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const save = async (i: Item) => {
    await dataPort().items.save(i)
    refresh()
    setEditing(null)
  }

  return (
    <SectionShell title="Items & services" onNew={() => setEditing('new')} onImport={() => setImporting(true)}>
      <Table headers={['SKU', 'Name', 'Kind', 'Unit price', 'VAT class', 'Status', '']}>
        {(data ?? []).length === 0 && <EmptyRow span={7} label="No items yet." />}
        {(data ?? []).map((i) => (
          <tr key={i.id} className={`border-t border-slate-100 ${i.active ? '' : 'opacity-50'}`}>
            <td className="px-2 py-1.5 font-mono text-xs">{i.sku}</td>
            <td className="px-2 py-1.5 font-medium">{i.name}</td>
            <td className="px-2 py-1.5 text-xs">{i.kind}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{Money.fromCentavos(i.unitPriceCentavos).format()}</td>
            <td className="px-2 py-1.5 text-xs">{i.defaultVatClass.replace('_', '-')}</td>
            <td className="px-2 py-1.5 text-xs">{i.active ? 'active' : 'inactive'}</td>
            <td className="px-2 py-1.5">
              <RowActions
                active={i.active}
                referenced={referenced.has(i.id)}
                onEdit={() => setEditing(i)}
                onToggleActive={() => void save({ ...i, active: !i.active })}
                onDelete={() => void dataPort().items.delete(i.id).then(refresh)}
              />
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <ItemForm
          companyId={companyId}
          initial={editing === 'new' ? null : editing}
          accountOptions={(accounts.data ?? []).filter((a) => a.postable)}
          onSave={(i) => void save(i)}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportDialog
          spec={ITEM_IMPORT_SPEC}
          companyId={companyId}
          onImport={async (rows) => {
            for (const r of rows) await dataPort().items.save(r)
            refresh()
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </SectionShell>
  )
}

function ItemForm({
  companyId,
  initial,
  accountOptions,
  onSave,
  onClose,
}: {
  companyId: string
  initial: Item | null
  accountOptions: { code: string; name: string; type: string }[]
  onSave(i: Item): void
  onClose(): void
}) {
  const [f, setF] = useState({
    sku: initial?.sku ?? '',
    name: initial?.name ?? '',
    kind: initial?.kind ?? ('good' as const),
    unitPrice: initial ? Money.fromCentavos(initial.unitPriceCentavos).format().replace(/,/g, '') : '',
    vatClass: initial?.defaultVatClass ?? ('vatable' as const),
    incomeAccountCode: initial?.incomeAccountCode ?? '4100',
    expenseAccountCode: initial?.expenseAccountCode ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    try {
      if (!f.sku.trim() || !f.name.trim()) throw new Error('SKU and name are required')
      onSave({
        id: initial?.id ?? `${companyId}:item:${f.sku.trim().toLowerCase()}`,
        companyId,
        sku: f.sku.trim(),
        name: f.name.trim(),
        kind: f.kind,
        unitPriceCentavos: Money.parse(f.unitPrice || '0').centavos,
        defaultVatClass: f.vatClass,
        incomeAccountCode: f.incomeAccountCode,
        expenseAccountCode: f.expenseAccountCode || null,
        active: initial?.active ?? true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const income = accountOptions.filter((a) => a.type === 'income')
  const expense = accountOptions.filter((a) => a.type === 'expense' || a.type === 'asset')
  return (
    <Modal title={initial ? 'Edit item' : 'New item / service'} onClose={onClose}>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        <L label="SKU / code">
          <input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        </L>
        <L label="Kind">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'good' | 'service' })}>
            <option value="good">Good</option>
            <option value="service">Service</option>
          </select>
        </L>
        <L label="Unit price (₱)">
          <input className="input" inputMode="decimal" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} />
        </L>
      </div>
      <L label="Name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </L>
      <div className="grid grid-cols-3 gap-3">
        <L label="Default VAT class">
          <select className="input" value={f.vatClass} onChange={(e) => setF({ ...f, vatClass: e.target.value as Item['defaultVatClass'] })}>
            <option value="vatable">VATable</option>
            <option value="exempt">Exempt</option>
            <option value="zero_rated">Zero-rated</option>
          </select>
        </L>
        <L label="Income account">
          <select className="input" value={f.incomeAccountCode} onChange={(e) => setF({ ...f, incomeAccountCode: e.target.value })}>
            {income.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </L>
        <L label="Expense account">
          <select className="input" value={f.expenseAccountCode} onChange={(e) => setF({ ...f, expenseAccountCode: e.target.value })}>
            <option value="">—</option>
            {expense.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </L>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Save</button>
      </div>
    </Modal>
  )
}

// ---------------- ATC codes ----------------

function AtcSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('atcCodes', companyId, () => dataPort().atcCodes.list(companyId))
  const [editing, setEditing] = useState<AtcCode | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const builtIn = rules.withholding(today).atcRates

  const save = async (a: AtcCode) => {
    await dataPort().atcCodes.save(a)
    refresh()
    setEditing(null)
  }

  return (
    <div className="space-y-4">
      <SectionShell title="Company ATC codes" onNew={() => setEditing('new')} onImport={() => setImporting(true)}>
        <Table headers={['ATC', 'Kind', 'Payee class', 'Nature of payment', 'Rate', 'Status', '']}>
          {(data ?? []).length === 0 && (
            <EmptyRow span={7} label="No company-specific ATC rows — the built-in matrix below applies." />
          )}
          {(data ?? []).map((a) => (
            <tr key={a.id} className={`border-t border-slate-100 ${a.active ? '' : 'opacity-50'}`}>
              <td className="px-2 py-1.5 font-mono text-xs font-semibold">{a.atc}</td>
              <td className="px-2 py-1.5 text-xs">{a.kind}</td>
              <td className="px-2 py-1.5 text-xs">{a.payeeClass}</td>
              <td className="px-2 py-1.5">{a.natureOfPayment}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{a.ratePercent}%</td>
              <td className="px-2 py-1.5 text-xs">{a.active ? 'active' : 'inactive'}</td>
              <td className="px-2 py-1.5">
                <RowActions
                  active={a.active}
                  referenced={false}
                  onEdit={() => setEditing(a)}
                  onToggleActive={() => void save({ ...a, active: !a.active })}
                  onDelete={() => void dataPort().atcCodes.delete(a.id).then(refresh)}
                />
              </td>
            </tr>
          ))}
        </Table>
        {editing && (
          <AtcForm
            companyId={companyId}
            initial={editing === 'new' ? null : editing}
            onSave={(a) => void save(a)}
            onClose={() => setEditing(null)}
          />
        )}
        {importing && (
          <ImportDialog
            spec={ATC_IMPORT_SPEC as ImportSpec<AtcCode, ImportCtx>}
            companyId={companyId}
            onImport={async (rows) => {
              for (const r of rows) await dataPort().atcCodes.save(r)
              refresh()
            }}
            onClose={() => setImporting(false)}
          />
        )}
      </SectionShell>

      <SectionShell title="Built-in ATC matrix (rules table, read-only)">
        <Table headers={['ATC', 'Kind', 'Payee class', 'Nature of payment', 'Rate']}>
          {builtIn.map((a) => (
            <tr key={a.atc} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-mono text-xs font-semibold">{a.atc}</td>
              <td className="px-2 py-1.5 text-xs">{a.kind}</td>
              <td className="px-2 py-1.5 text-xs">{a.payeeClass}</td>
              <td className="px-2 py-1.5">{a.natureOfPayment}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {((a.rate.num / a.rate.den) * 100).toFixed(2).replace(/\.?0+$/, '')}%
                {a.higherRate && ` / ${((a.higherRate.num / a.higherRate.den) * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </Table>
      </SectionShell>
    </div>
  )
}

function AtcForm({
  companyId,
  initial,
  onSave,
  onClose,
}: {
  companyId: string
  initial: AtcCode | null
  onSave(a: AtcCode): void
  onClose(): void
}) {
  const [f, setF] = useState({
    atc: initial?.atc ?? '',
    kind: initial?.kind ?? ('expanded' as const),
    payeeClass: initial?.payeeClass ?? ('corporation' as const),
    natureOfPayment: initial?.natureOfPayment ?? '',
    ratePercent: initial ? String(initial.ratePercent) : '',
  })
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const rate = Number(f.ratePercent)
    if (!f.atc.trim() || !f.natureOfPayment.trim()) return setError('ATC and nature of payment are required')
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError('Rate must be 0-100')
    onSave({
      id: initial?.id ?? `${companyId}:atc:${f.atc.trim().toUpperCase()}`,
      companyId,
      atc: f.atc.trim().toUpperCase(),
      kind: f.kind,
      payeeClass: f.payeeClass,
      natureOfPayment: f.natureOfPayment.trim(),
      ratePercent: rate,
      active: initial?.active ?? true,
    })
  }
  return (
    <Modal title={initial ? 'Edit ATC code' : 'New ATC code'} onClose={onClose}>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        <L label="ATC">
          <input className="input" placeholder="WC050" value={f.atc} onChange={(e) => setF({ ...f, atc: e.target.value })} />
        </L>
        <L label="Kind">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'expanded' | 'final' })}>
            <option value="expanded">Expanded</option>
            <option value="final">Final</option>
          </select>
        </L>
        <L label="Payee class">
          <select className="input" value={f.payeeClass} onChange={(e) => setF({ ...f, payeeClass: e.target.value as 'individual' | 'corporation' })}>
            <option value="corporation">Corporation</option>
            <option value="individual">Individual</option>
          </select>
        </L>
      </div>
      <L label="Nature of payment">
        <input className="input" value={f.natureOfPayment} onChange={(e) => setF({ ...f, natureOfPayment: e.target.value })} />
      </L>
      <L label="Rate (%)">
        <input className="input" inputMode="decimal" value={f.ratePercent} onChange={(e) => setF({ ...f, ratePercent: e.target.value })} />
      </L>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button onClick={submit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Save</button>
      </div>
    </Modal>
  )
}

// ---------------- Numbering series ----------------

function NumberingSection({ companyId }: { companyId: string }) {
  const { data, refresh } = useMasterList('numbering', companyId, () => dataPort().numbering.list(companyId))
  const [editing, setEditing] = useState<NumberingSeries | 'new' | null>(null)

  const save = async (n: NumberingSeries) => {
    await dataPort().numbering.save(n)
    refresh()
    setEditing(null)
  }

  return (
    <SectionShell title="Document numbering series" onNew={() => setEditing('new')}>
      <p className="mb-3 text-xs text-slate-500">
        Numbers are reserved when a document posts (drafts never burn a number). One series per
        document type.
      </p>
      <Table headers={['Document type', 'Prefix', 'Padding', 'Next number', 'Authority ref', '']}>
        {(data ?? []).length === 0 && <EmptyRow span={6} label="No series yet — posting will ask for manual numbers until one exists." />}
        {(data ?? []).map((n) => (
          <tr key={n.id} className="border-t border-slate-100">
            <td className="px-2 py-1.5">{n.documentType.replace(/_/g, ' ')}</td>
            <td className="px-2 py-1.5 font-mono text-xs">{n.prefix}</td>
            <td className="px-2 py-1.5">{n.padding}</td>
            <td className="px-2 py-1.5 tabular-nums">{n.nextNumber}</td>
            <td className="px-2 py-1.5 text-xs">{n.authorityRef ?? '—'}</td>
            <td className="px-2 py-1.5 text-right">
              <button onClick={() => setEditing(n)} className="text-xs text-brand-600 hover:underline">Edit</button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <NumberingForm
          companyId={companyId}
          initial={editing === 'new' ? null : editing}
          onSave={(n) => void save(n)}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionShell>
  )
}

const DOCUMENT_TYPES = [
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

function NumberingForm({
  companyId,
  initial,
  onSave,
  onClose,
}: {
  companyId: string
  initial: NumberingSeries | null
  onSave(n: NumberingSeries): void
  onClose(): void
}) {
  const [f, setF] = useState({
    documentType: initial?.documentType ?? 'sales_invoice',
    prefix: initial?.prefix ?? 'SI-',
    padding: initial?.padding ?? 4,
    nextNumber: initial?.nextNumber ?? 1,
    authorityRef: initial?.authorityRef ?? '',
  })
  return (
    <Modal title={initial ? 'Edit series' : 'New numbering series'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <L label="Document type">
          <select className="input" value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value })}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </L>
        <L label="Prefix">
          <input className="input" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} />
        </L>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <L label="Padding (digits)">
          <input className="input" type="number" min={1} max={10} value={f.padding} onChange={(e) => setF({ ...f, padding: Number(e.target.value) })} />
        </L>
        <L label="Next number">
          <input className="input" type="number" min={1} value={f.nextNumber} onChange={(e) => setF({ ...f, nextNumber: Number(e.target.value) })} />
        </L>
        <L label="ATP / OCN ref">
          <input className="input" value={f.authorityRef} onChange={(e) => setF({ ...f, authorityRef: e.target.value })} />
        </L>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Cancel</button>
        <button
          onClick={() =>
            onSave({
              id: initial?.id ?? `${companyId}-ns-${f.documentType}`,
              companyId,
              documentType: f.documentType,
              prefix: f.prefix,
              padding: f.padding,
              nextNumber: f.nextNumber,
              authorityRef: f.authorityRef || null,
            })
          }
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Save
        </button>
      </div>
    </Modal>
  )
}
