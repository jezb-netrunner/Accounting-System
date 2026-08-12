import { useState } from 'react'
import type { AccountTemplateRow, AccountType, SystemRole, TaxTag } from '../../domain/coa'

/**
 * Chart-of-accounts editor used before go-live (and to extend later): add,
 * rename, deactivate, and re-map tax tags / system roles. Reports follow
 * tags and roles, never codes, so re-mapping is safe by design.
 */

export interface EditableCoaRow extends AccountTemplateRow {
  active: boolean
}

export const toEditableRows = (rows: readonly AccountTemplateRow[]): EditableCoaRow[] =>
  rows.map((r) => ({ ...r, active: true }))

const TAX_TAGS: TaxTag[] = [
  'none',
  'output_vat',
  'input_vat',
  'deferred_input_vat',
  'vat_payable',
  'percentage_tax_expense',
  'ewt_payable',
  'fwt_payable',
  'compensation_wtax_payable',
  'creditable_wtax_receivable',
  'creditable_vat_withheld',
  'income_tax_payable',
  'dst_payable',
  'sales_vatable',
  'sales_exempt',
  'sales_zero_rated',
  'purchases_vatable',
  'purchases_exempt',
  'salaries_wages',
  'sss_philhealth_pagibig_payable',
]

const SYSTEM_ROLES: (SystemRole | '')[] = [
  '',
  'cash',
  'accounts_receivable',
  'accounts_payable',
  'inventory',
  'sales',
  'purchases',
  'salaries_expense',
  'salaries_payable',
  'owners_equity',
  'retained_earnings',
]

const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']

interface Props {
  rows: EditableCoaRow[]
  onChange(rows: EditableCoaRow[]): void
}

export function CoaEditor({ rows, onChange }: Props) {
  const [newRow, setNewRow] = useState({ code: '', name: '', type: 'expense' as AccountType })

  const update = (code: string, patch: Partial<EditableCoaRow>) =>
    onChange(rows.map((r) => (r.code === code ? { ...r, ...patch } : r)))

  const addRow = () => {
    if (!newRow.code || !newRow.name) return
    if (rows.some((r) => r.code === newRow.code)) return
    onChange(
      [...rows, { ...newRow, taxTag: 'none' as TaxTag, parentCode: null, postable: true, active: true }].sort(
        (a, b) => a.code.localeCompare(b.code),
      ),
    )
    setNewRow({ code: '', name: '', type: 'expense' })
  }

  return (
    <div className="space-y-3">
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Code</th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5">Tax tag</th>
              <th className="px-2 py-1.5">System role</th>
              <th className="px-2 py-1.5">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className={`border-t border-slate-100 ${r.active ? '' : 'opacity-40'}`}>
                <td className="px-2 py-1 font-mono text-xs">{r.code}</td>
                <td className="px-2 py-1">
                  <input
                    className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-200 focus:border-brand-500 focus:outline-none ${r.postable === false ? 'font-semibold' : ''}`}
                    value={r.name}
                    onChange={(e) => update(r.code, { name: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1 text-xs text-slate-500">{r.type}</td>
                <td className="px-2 py-1">
                  <select
                    className="w-full bg-transparent text-xs"
                    value={r.taxTag}
                    onChange={(e) => update(r.code, { taxTag: e.target.value as TaxTag })}
                    disabled={r.postable === false}
                  >
                    {TAX_TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t === 'none' ? '—' : t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <select
                    className="w-full bg-transparent text-xs"
                    value={r.systemRole ?? ''}
                    onChange={(e) =>
                      update(r.code, { systemRole: (e.target.value || undefined) as SystemRole | undefined })
                    }
                    disabled={r.postable === false}
                  >
                    {SYSTEM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role === '' ? '—' : role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={r.active}
                    disabled={r.postable === false}
                    onChange={(e) => update(r.code, { active: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                    title={r.active ? 'Deactivate' : 'Reactivate'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-end gap-2 rounded-lg bg-slate-50 p-3">
        <label className="block w-24">
          <span className="mb-1 block text-xs text-slate-500">Code</span>
          <input
            className="input"
            value={newRow.code}
            placeholder="5150"
            onChange={(e) => setNewRow({ ...newRow, code: e.target.value.trim() })}
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs text-slate-500">Account name</span>
          <input
            className="input"
            value={newRow.name}
            placeholder="Freight & Delivery"
            onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
          />
        </label>
        <label className="block w-32">
          <span className="mb-1 block text-xs text-slate-500">Type</span>
          <select
            className="input"
            value={newRow.type}
            onChange={(e) => setNewRow({ ...newRow, type: e.target.value as AccountType })}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-white"
        >
          + Add account
        </button>
      </div>
    </div>
  )
}
