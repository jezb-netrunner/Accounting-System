/**
 * Money as integer centavos. No floats anywhere in domain arithmetic.
 *
 * All tax computations multiply a Money base by a rational rate
 * (e.g. VAT net-of-gross = gross * 100/112) using integer math, and round
 * half-up only at the explicit points BIR requires it.
 */

export type Centavos = number

/** A rational multiplier, e.g. 12% = { num: 12, den: 100 }. */
export interface Rate {
  readonly num: number
  readonly den: number
}

export const rate = (num: number, den: number): Rate => {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
    throw new MoneyError(`Invalid rate ${num}/${den}`)
  }
  return { num, den }
}

/** Convenience: percent as a rate, e.g. pct(12) = 12%. Accepts up to 4 decimal places. */
export const pct = (percent: number): Rate => {
  const scaled = Math.round(percent * 10_000)
  if (Math.abs(scaled - percent * 10_000) > 1e-6) {
    throw new MoneyError(`Percent ${percent} has more than 4 decimal places`)
  }
  return rate(scaled, 1_000_000)
}

export class MoneyError extends Error {}

const assertCentavos = (value: number): Centavos => {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Amount must be integer centavos, got ${value}`)
  }
  return value
}

export class Money {
  private constructor(readonly centavos: Centavos) {}

  static fromCentavos(centavos: number): Money {
    return new Money(assertCentavos(centavos))
  }

  /** Parse a decimal peso string ("1234.56") exactly; rejects >2 decimal places. */
  static parse(pesos: string): Money {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(pesos.trim().replace(/,/g, ''))
    if (!m) throw new MoneyError(`Cannot parse peso amount "${pesos}"`)
    const [, sign, whole, frac = ''] = m
    const centavos = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
    return Money.fromCentavos(sign === '-' ? -centavos : centavos)
  }

  /** Whole pesos, exact (no fractional part allowed). */
  static pesos(pesos: number): Money {
    if (!Number.isSafeInteger(pesos)) {
      throw new MoneyError(`Money.pesos expects an integer, got ${pesos}. Use Money.parse for decimals.`)
    }
    return Money.fromCentavos(pesos * 100)
  }

  static readonly ZERO = new Money(0)

  add(other: Money): Money {
    return Money.fromCentavos(this.centavos + other.centavos)
  }

  subtract(other: Money): Money {
    return Money.fromCentavos(this.centavos - other.centavos)
  }

  negate(): Money {
    return Money.fromCentavos(-this.centavos)
  }

  abs(): Money {
    return Money.fromCentavos(Math.abs(this.centavos))
  }

  /**
   * Multiply by a rational rate, rounding half-up (BIR convention) at the
   * centavo. Half-up on negatives rounds away from zero on .5 exactly
   * (-0.5 → -1), matching how reversal entries must mirror originals.
   */
  multiply(r: Rate): Money {
    return Money.fromCentavos(mulDivHalfUp(this.centavos, r.num, r.den))
  }

  /** Split into n parts that sum exactly to the original (largest-remainder). */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) throw new MoneyError('allocate needs at least one weight')
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) throw new MoneyError('allocate weights must sum to a positive number')
    const shares = weights.map((w) => Math.floor((this.centavos * w) / total))
    let remainder = this.centavos - shares.reduce((a, b) => a + b, 0)
    // Distribute leftover centavos to the largest fractional remainders first.
    const order = weights
      .map((w, i) => ({ i, frac: (this.centavos * w) % total }))
      .sort((a, b) => b.frac - a.frac)
    for (const { i } of order) {
      if (remainder === 0) break
      shares[i] = (shares[i] ?? 0) + 1
      remainder -= 1
    }
    return shares.map((s) => Money.fromCentavos(s))
  }

  isZero(): boolean {
    return this.centavos === 0
  }

  isNegative(): boolean {
    return this.centavos < 0
  }

  equals(other: Money): boolean {
    return this.centavos === other.centavos
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.centavos < other.centavos ? -1 : this.centavos > other.centavos ? 1 : 0
  }

  greaterThan(other: Money): boolean {
    return this.centavos > other.centavos
  }

  lessThan(other: Money): boolean {
    return this.centavos < other.centavos
  }

  /** "1,234.56" — no currency symbol; callers add ₱ where needed. */
  format(): string {
    const sign = this.centavos < 0 ? '-' : ''
    const abs = Math.abs(this.centavos)
    const whole = Math.floor(abs / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const frac = (abs % 100).toString().padStart(2, '0')
    return `${sign}${whole}.${frac}`
  }

  toJSON(): number {
    return this.centavos
  }
}

/**
 * round-half-up((value * num) / den) in pure integer arithmetic.
 * Uses BigInt so intermediate products can't lose precision.
 */
export function mulDivHalfUp(value: number, num: number, den: number): number {
  const v = BigInt(assertCentavos(value)) * BigInt(num)
  const d = BigInt(den)
  const negative = v < 0n !== d < 0n
  const av = v < 0n ? -v : v
  const ad = d < 0n ? -d : d
  const q = av / ad
  const rem = av % ad
  // half-up: .5 exactly rounds up (away from zero)
  const rounded = rem * 2n >= ad ? q + 1n : q
  const result = negative ? -rounded : rounded
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Money overflow')
  }
  return Number(result)
}

export const sum = (monies: readonly Money[]): Money =>
  monies.reduce((acc, m) => acc.add(m), Money.ZERO)
