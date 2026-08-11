import type { TIN } from './core'

/**
 * Master-data validation helpers. Throwing validators return the parsed
 * value; UI and importer catch and surface the message per field/cell.
 */

/** Parse a TIN in any common shape: 123-456-789-000, 123456789, spaces, 5-digit branch. */
export function validateTinString(raw: string): TIN {
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits) || (digits.length !== 9 && digits.length !== 12 && digits.length !== 14)) {
    if (/^\d{9}$/.test(digits)) return { base: digits, branchCode: '000' }
    if (/^\d+$/.test(digits) && digits.length > 9) {
      throw new Error(`TIN branch code must be 3 or 5 digits, got "${digits.slice(9)}"`)
    }
    throw new Error(`TIN must be 9 digits (plus optional branch code), got "${raw}"`)
  }
  const base = digits.slice(0, 9)
  const branchCode = digits.length === 9 ? '000' : digits.slice(9)
  return { base, branchCode }
}

export function validateRequired(value: string, label: string): string {
  const v = value.trim()
  if (!v) throw new Error(`${label} is required`)
  return v
}

export function validateBoolean(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (['y', 'yes', 'true', '1', 'x'].includes(v)) return true
  if (['', 'n', 'no', 'false', '0'].includes(v)) return false
  throw new Error(`"${value}" is not a yes/no value`)
}

export function validateDate(value: string, label: string): string {
  const v = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // Accept common spreadsheet form d/m/yyyy or m/d/yyyy? No — ambiguous. Require ISO.
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD), got "${value}"`)
  }
  return v
}

export function validateOneOf<T extends string>(value: string, options: readonly T[], label: string): T {
  const v = value.trim().toLowerCase() as T
  if (!options.includes(v)) {
    throw new Error(`${label} must be one of ${options.join(', ')}, got "${value}"`)
  }
  return v
}
