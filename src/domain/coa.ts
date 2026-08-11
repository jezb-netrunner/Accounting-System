import type { AccountId, CompanyId } from './core'

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export type NormalBalance = 'debit' | 'credit'

export const normalBalanceOf = (type: AccountType): NormalBalance =>
  type === 'asset' || type === 'expense' ? 'debit' : 'credit'

/**
 * Tax-relevant tagging: how an account participates in tax computation and
 * report mapping. This is what lets returns and books be generated from the
 * ledger without hardcoding account codes anywhere.
 */
export type TaxTag =
  | 'output_vat'
  | 'input_vat'
  | 'deferred_input_vat'
  | 'vat_payable'
  | 'percentage_tax_expense'
  | 'ewt_payable' // expanded withholding we owe BIR as agent
  | 'fwt_payable'
  | 'compensation_wtax_payable'
  | 'creditable_wtax_receivable' // 2307s we received from customers
  | 'income_tax_payable'
  | 'dst_payable'
  | 'sales_vatable'
  | 'sales_exempt'
  | 'sales_zero_rated'
  | 'purchases_vatable'
  | 'purchases_exempt'
  | 'salaries_wages'
  | 'sss_philhealth_pagibig_payable'
  | 'none'

/**
 * Structural roles the posting engine resolves by (AR for invoices, AP for
 * bills, …). Distinct from TaxTag: a role says where an amount posts, a tax
 * tag says how it enters tax computations and reports.
 */
export type SystemRole =
  | 'cash'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'salaries_expense'
  | 'salaries_payable'
  | 'owners_equity'
  | 'retained_earnings'

export interface Account {
  readonly id: AccountId
  readonly companyId: CompanyId
  /** Sortable code, e.g. "1100". Unique within a company. */
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly taxTag: TaxTag
  readonly systemRole: SystemRole | null
  /** Parent for report roll-ups; null = top level. */
  readonly parentId: AccountId | null
  /** Postable leaf vs. header/summary account. */
  readonly postable: boolean
  readonly active: boolean
}

/** Template row used by the onboarding COA templates and seeds. */
export interface AccountTemplateRow {
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly taxTag: TaxTag
  readonly systemRole?: SystemRole
  readonly parentCode: string | null
  readonly postable?: boolean
}

export const instantiateTemplate = (
  companyId: CompanyId,
  rows: readonly AccountTemplateRow[],
): Account[] => {
  const idOf = (code: string) => `${companyId}:acct:${code}`
  return rows.map((r) => ({
    id: idOf(r.code),
    companyId,
    code: r.code,
    name: r.name,
    type: r.type,
    normalBalance: normalBalanceOf(r.type),
    taxTag: r.taxTag,
    systemRole: r.systemRole ?? null,
    parentId: r.parentCode ? idOf(r.parentCode) : null,
    postable: r.postable ?? true,
    active: true,
  }))
}
