import type { CompanyId } from './core'
import { CellError, type ImportSpec } from './importer'
import type { AtcCode, BankAccount, Employee, Item, Party } from './masterData'
import {
  validateBoolean,
  validateDate,
  validateOneOf,
  validateRequired,
  validateTinString,
} from './validation'

/** Import specs: one per master-data entity, consumed by the import dialog. */

export interface ImportCtx {
  readonly companyId: CompanyId
}

const cell = <T>(key: string, fn: () => T): T => {
  try {
    return fn()
  } catch (err) {
    throw new CellError(key, err instanceof Error ? err.message : String(err))
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24)

export const PARTY_IMPORT_SPEC: ImportSpec<Party, ImportCtx> = {
  entity: 'Customers & suppliers',
  columns: [
    { key: 'registeredName', label: 'Registered name', required: true, aliases: ['name', 'company'] },
    { key: 'tin', label: 'TIN', required: true, aliases: ['tin no', 'tax identification number'] },
    { key: 'role', label: 'Role', required: true, aliases: ['type', 'customer or supplier'] },
    { key: 'payeeClass', label: 'Payee class', required: false, aliases: ['class', 'individual/corporation'] },
    { key: 'businessStyle', label: 'Business style', required: false, aliases: ['trade name'] },
    { key: 'address', label: 'Registered address', required: false, aliases: ['registered address'] },
    { key: 'zipCode', label: 'ZIP code', required: false, aliases: ['zip'] },
    { key: 'isGovernment', label: 'Government payor', required: false, aliases: ['government', 'gocc'] },
    { key: 'defaultAtc', label: 'Default ATC', required: false, aliases: ['atc'] },
  ],
  build(v, ctx) {
    const registeredName = cell('registeredName', () => validateRequired(v.registeredName!, 'Registered name'))
    const tin = cell('tin', () => validateTinString(validateRequired(v.tin!, 'TIN')))
    const role = cell('role', () =>
      validateOneOf(v.role!, ['customer', 'supplier', 'both'] as const, 'Role'),
    )
    const payeeClass = v.payeeClass
      ? cell('payeeClass', () =>
          validateOneOf(v.payeeClass!, ['individual', 'corporation'] as const, 'Payee class'),
        )
      : 'corporation'
    return {
      id: `${ctx.companyId}:party:${tin.base}-${tin.branchCode}-${slug(registeredName)}`,
      companyId: ctx.companyId,
      tin,
      registeredName,
      businessStyle: v.businessStyle ?? '',
      registeredAddress: v.address ?? '',
      ...(v.zipCode ? { zipCode: v.zipCode } : {}),
      isCustomer: role === 'customer' || role === 'both',
      isSupplier: role === 'supplier' || role === 'both',
      payeeClass,
      isGovernment: cell('isGovernment', () => validateBoolean(v.isGovernment ?? '')),
      defaultAtc: v.defaultAtc || null,
      mergedIntoId: null,
      active: true,
    }
  },
}

export const EMPLOYEE_IMPORT_SPEC: ImportSpec<Employee, ImportCtx> = {
  entity: 'Employees',
  columns: [
    { key: 'employeeNo', label: 'Employee no.', required: true, aliases: ['emp no', 'number'] },
    { key: 'lastName', label: 'Last name', required: true, aliases: ['surname'] },
    { key: 'firstName', label: 'First name', required: true, aliases: ['given name'] },
    { key: 'middleName', label: 'Middle name', required: false },
    { key: 'tin', label: 'TIN', required: true },
    { key: 'monthlyPay', label: 'Monthly basic pay', required: true, aliases: ['basic pay', 'salary', 'monthly salary'] },
    { key: 'hireDate', label: 'Hire date', required: true, aliases: ['date hired'] },
    { key: 'address', label: 'Address', required: false },
    { key: 'sssNo', label: 'SSS no.', required: false, aliases: ['sss'] },
    { key: 'philhealthNo', label: 'PhilHealth no.', required: false, aliases: ['philhealth'] },
    { key: 'pagibigNo', label: 'Pag-IBIG no.', required: false, aliases: ['pagibig', 'hdmf'] },
  ],
  build(v, ctx) {
    const employeeNo = cell('employeeNo', () => validateRequired(v.employeeNo!, 'Employee no.'))
    const lastName = cell('lastName', () => validateRequired(v.lastName!, 'Last name'))
    const firstName = cell('firstName', () => validateRequired(v.firstName!, 'First name'))
    const tin = cell('tin', () => validateTinString(validateRequired(v.tin!, 'TIN')))
    const monthlyPay = cell('monthlyPay', () => {
      const cleaned = (v.monthlyPay ?? '').replace(/[,\s₱]/g, '')
      if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`"${v.monthlyPay}" is not a peso amount`)
      return Math.round(Number(cleaned) * 100)
    })
    return {
      id: `${ctx.companyId}:emp:${employeeNo}`,
      companyId: ctx.companyId,
      employeeNo,
      tin,
      registeredName: `${lastName}, ${firstName}${v.middleName ? ` ${v.middleName}` : ''}`,
      businessStyle: '',
      registeredAddress: v.address ?? '',
      firstName,
      lastName,
      middleName: v.middleName || null,
      hireDate: cell('hireDate', () => validateDate(v.hireDate!, 'Hire date')),
      separationDate: null,
      monthlyBasicPayCentavos: monthlyPay,
      sssNo: v.sssNo || null,
      philhealthNo: v.philhealthNo || null,
      pagibigNo: v.pagibigNo || null,
      active: true,
    }
  },
}

export const ITEM_IMPORT_SPEC: ImportSpec<Item, ImportCtx> = {
  entity: 'Items & services',
  columns: [
    { key: 'sku', label: 'SKU / code', required: true, aliases: ['code', 'item code'] },
    { key: 'name', label: 'Name', required: true, aliases: ['description'] },
    { key: 'kind', label: 'Kind (good/service)', required: false, aliases: ['type'] },
    { key: 'unitPrice', label: 'Unit price', required: false, aliases: ['price', 'srp'] },
    { key: 'vatClass', label: 'VAT class', required: false, aliases: ['vat'] },
    { key: 'incomeAccount', label: 'Income account code', required: false, aliases: ['income account'] },
    { key: 'expenseAccount', label: 'Expense account code', required: false, aliases: ['expense account'] },
  ],
  build(v, ctx) {
    const sku = cell('sku', () => validateRequired(v.sku!, 'SKU'))
    const name = cell('name', () => validateRequired(v.name!, 'Name'))
    const kind = v.kind ? cell('kind', () => validateOneOf(v.kind!, ['good', 'service'] as const, 'Kind')) : 'good'
    const unitPrice = cell('unitPrice', () => {
      if (!v.unitPrice) return 0
      const cleaned = v.unitPrice.replace(/[,\s₱]/g, '')
      if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`"${v.unitPrice}" is not a peso amount`)
      return Math.round(Number(cleaned) * 100)
    })
    const vatClass = v.vatClass
      ? cell('vatClass', () =>
          validateOneOf(v.vatClass!, ['vatable', 'exempt', 'zero_rated'] as const, 'VAT class'),
        )
      : 'vatable'
    return {
      id: `${ctx.companyId}:item:${slug(sku)}`,
      companyId: ctx.companyId,
      sku,
      name,
      kind,
      unitPriceCentavos: unitPrice,
      defaultVatClass: vatClass,
      incomeAccountCode: v.incomeAccount || '4100',
      expenseAccountCode: v.expenseAccount || null,
      active: true,
    }
  },
}

export const BANK_ACCOUNT_IMPORT_SPEC: ImportSpec<BankAccount, ImportCtx> = {
  entity: 'Bank accounts',
  columns: [
    { key: 'bankName', label: 'Bank', required: true, aliases: ['bank name'] },
    { key: 'accountName', label: 'Account name', required: true },
    { key: 'accountNo', label: 'Account no.', required: true, aliases: ['account number'] },
    { key: 'glAccountCode', label: 'GL account code', required: false, aliases: ['gl code'] },
  ],
  build(v, ctx) {
    const bankName = cell('bankName', () => validateRequired(v.bankName!, 'Bank'))
    const accountNo = cell('accountNo', () => validateRequired(v.accountNo!, 'Account no.'))
    return {
      id: `${ctx.companyId}:bank:${slug(`${bankName}-${accountNo}`)}`,
      companyId: ctx.companyId,
      bankName,
      accountName: cell('accountName', () => validateRequired(v.accountName!, 'Account name')),
      accountNo,
      glAccountCode: v.glAccountCode || '1110',
      active: true,
    }
  },
}

export const ATC_IMPORT_SPEC: ImportSpec<AtcCode, ImportCtx> = {
  entity: 'ATC codes',
  columns: [
    { key: 'atc', label: 'ATC', required: true, aliases: ['code'] },
    { key: 'kind', label: 'Kind (expanded/final)', required: false, aliases: ['type'] },
    { key: 'payeeClass', label: 'Payee class', required: false },
    { key: 'natureOfPayment', label: 'Nature of payment', required: true, aliases: ['nature', 'description'] },
    { key: 'ratePercent', label: 'Rate %', required: true, aliases: ['rate'] },
  ],
  build(v, ctx) {
    const atc = cell('atc', () => validateRequired(v.atc!, 'ATC').toUpperCase())
    const rate = cell('ratePercent', () => {
      const cleaned = (v.ratePercent ?? '').replace(/%/g, '').trim()
      const n = Number(cleaned)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`"${v.ratePercent}" is not a rate`)
      return n
    })
    return {
      id: `${ctx.companyId}:atc:${atc}`,
      companyId: ctx.companyId,
      atc,
      kind: v.kind ? validateOneOf(v.kind, ['expanded', 'final'] as const, 'Kind') : 'expanded',
      payeeClass: v.payeeClass
        ? validateOneOf(v.payeeClass, ['individual', 'corporation'] as const, 'Payee class')
        : 'corporation',
      natureOfPayment: cell('natureOfPayment', () => validateRequired(v.natureOfPayment!, 'Nature of payment')),
      ratePercent: rate,
      active: true,
    }
  },
}
