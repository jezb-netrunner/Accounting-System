import type { AccountTemplateRow } from '../domain/coa'

/**
 * Standard PH SME chart of accounts template. Onboarding instantiates it per
 * company; the tax tags and system roles are what the posting engine and the
 * BIR report generators resolve against, so a custom COA works as long as the
 * tags survive.
 */
export const STANDARD_PH_COA: readonly AccountTemplateRow[] = [
  // ---- Assets ----
  { code: '1000', name: 'ASSETS', type: 'asset', taxTag: 'none', parentCode: null, postable: false },
  { code: '1100', name: 'Cash on Hand', type: 'asset', taxTag: 'none', systemRole: 'cash', parentCode: '1000' },
  { code: '1110', name: 'Cash in Bank', type: 'asset', taxTag: 'none', parentCode: '1000' },
  { code: '1200', name: 'Accounts Receivable — Trade', type: 'asset', taxTag: 'none', systemRole: 'accounts_receivable', parentCode: '1000' },
  { code: '1250', name: 'Creditable Withholding Tax (2307/2306)', type: 'asset', taxTag: 'creditable_wtax_receivable', parentCode: '1000' },
  { code: '1300', name: 'Inventory', type: 'asset', taxTag: 'none', systemRole: 'inventory', parentCode: '1000' },
  { code: '1400', name: 'Input VAT', type: 'asset', taxTag: 'input_vat', parentCode: '1000' },
  { code: '1410', name: 'Deferred Input VAT (capital goods)', type: 'asset', taxTag: 'deferred_input_vat', parentCode: '1000' },
  { code: '1500', name: 'Property, Plant & Equipment', type: 'asset', taxTag: 'none', parentCode: '1000' },

  // ---- Liabilities ----
  { code: '2000', name: 'LIABILITIES', type: 'liability', taxTag: 'none', parentCode: null, postable: false },
  { code: '2100', name: 'Accounts Payable — Trade', type: 'liability', taxTag: 'none', systemRole: 'accounts_payable', parentCode: '2000' },
  { code: '2200', name: 'Output VAT', type: 'liability', taxTag: 'output_vat', parentCode: '2000' },
  { code: '2210', name: 'VAT Payable', type: 'liability', taxTag: 'vat_payable', parentCode: '2000' },
  { code: '2300', name: 'Expanded Withholding Tax Payable', type: 'liability', taxTag: 'ewt_payable', parentCode: '2000' },
  { code: '2310', name: 'Final Withholding Tax Payable', type: 'liability', taxTag: 'fwt_payable', parentCode: '2000' },
  { code: '2320', name: 'Withholding Tax on Compensation Payable', type: 'liability', taxTag: 'compensation_wtax_payable', parentCode: '2000' },
  { code: '2330', name: 'SSS / PhilHealth / Pag-IBIG Payable', type: 'liability', taxTag: 'sss_philhealth_pagibig_payable', parentCode: '2000' },
  { code: '2400', name: 'Income Tax Payable', type: 'liability', taxTag: 'income_tax_payable', parentCode: '2000' },
  { code: '2410', name: 'Percentage Tax Payable', type: 'liability', taxTag: 'none', parentCode: '2000' },
  { code: '2420', name: 'DST Payable', type: 'liability', taxTag: 'dst_payable', parentCode: '2000' },
  { code: '2500', name: 'Salaries Payable', type: 'liability', taxTag: 'none', systemRole: 'salaries_payable', parentCode: '2000' },

  // ---- Equity ----
  { code: '3000', name: 'EQUITY', type: 'equity', taxTag: 'none', parentCode: null, postable: false },
  { code: '3100', name: "Owner's Capital / Share Capital", type: 'equity', taxTag: 'none', systemRole: 'owners_equity', parentCode: '3000' },
  { code: '3200', name: 'Retained Earnings', type: 'equity', taxTag: 'none', systemRole: 'retained_earnings', parentCode: '3000' },

  // ---- Income ----
  { code: '4000', name: 'INCOME', type: 'income', taxTag: 'none', parentCode: null, postable: false },
  { code: '4100', name: 'Sales — VATable', type: 'income', taxTag: 'sales_vatable', systemRole: 'sales', parentCode: '4000' },
  { code: '4110', name: 'Sales — Exempt', type: 'income', taxTag: 'sales_exempt', parentCode: '4000' },
  { code: '4120', name: 'Sales — Zero-Rated', type: 'income', taxTag: 'sales_zero_rated', parentCode: '4000' },
  { code: '4200', name: 'Service Income', type: 'income', taxTag: 'sales_vatable', parentCode: '4000' },
  { code: '4900', name: 'Other Income', type: 'income', taxTag: 'none', parentCode: '4000' },

  // ---- Expenses ----
  { code: '5000', name: 'EXPENSES', type: 'expense', taxTag: 'none', parentCode: null, postable: false },
  { code: '5100', name: 'Purchases / Cost of Sales', type: 'expense', taxTag: 'purchases_vatable', systemRole: 'purchases', parentCode: '5000' },
  { code: '5200', name: 'Salaries & Wages', type: 'expense', taxTag: 'salaries_wages', systemRole: 'salaries_expense', parentCode: '5000' },
  { code: '5210', name: 'SSS / PhilHealth / Pag-IBIG — Employer Share', type: 'expense', taxTag: 'none', parentCode: '5000' },
  { code: '5300', name: 'Rent Expense', type: 'expense', taxTag: 'purchases_vatable', parentCode: '5000' },
  { code: '5400', name: 'Professional Fees', type: 'expense', taxTag: 'purchases_vatable', parentCode: '5000' },
  { code: '5500', name: 'Utilities', type: 'expense', taxTag: 'purchases_vatable', parentCode: '5000' },
  { code: '5600', name: 'Office Supplies', type: 'expense', taxTag: 'purchases_vatable', parentCode: '5000' },
  { code: '5700', name: 'Taxes & Licenses', type: 'expense', taxTag: 'percentage_tax_expense', parentCode: '5000' },
  { code: '5800', name: 'Depreciation', type: 'expense', taxTag: 'none', parentCode: '5000' },
  { code: '5900', name: 'Miscellaneous Expense', type: 'expense', taxTag: 'none', parentCode: '5000' },
]
