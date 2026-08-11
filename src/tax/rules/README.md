# Tax rule tables

Rates, brackets, thresholds, and the ATC matrix live here as **versioned
data**, not code. The engine never hardcodes a rate; it resolves the block in
force on the transaction date via `rules.<table>(date)` (see `index.ts`), so a
2022 transaction computes with 2022 rules even when entered in 2026.

## Shape

Every table is an array of blocks extending `EffectivityBlock`:

```ts
{
  effectiveFrom: '2023-07-01',   // inclusive
  effectiveTo: null,             // inclusive; null = currently in force
  source: 'CREATE sunset',       // the statute/RR the block implements
  ...tableSpecificFields,
}
```

Amounts are **integer centavos** (`P(3_000_000)` = ₱3M). Rates are rationals
built with `pct()` / `rate()` from `src/lib/money.ts` — never floats.

## Adding a new effectivity block

Say Congress changes the percentage-tax rate to 2% starting 2027-01-01:

1. Open the table (`percentageTax.ts`).
2. Close the currently open block: set its `effectiveTo: '2026-12-31'`.
3. Append a new block with `effectiveFrom: '2027-01-01'`, `effectiveTo: null`,
   the new values, and a `source` citing the amending law/RR.
4. Add a test in `src/tax/engine/*.test.ts` asserting a date on each side of
   the boundary resolves to the right value.

Rules of thumb:

- **Never edit historical values.** Old blocks are how prior-period returns
  recompute correctly. If a value was wrong from the start, fix it and note
  the correction in the commit message.
- **No gaps.** `resolveEffective` throws `RuleNotFoundError` when no block
  covers a date — that's a data bug, not an engine bug.
- **Contiguity is tested** in `rules.test.ts`; a new block that leaves a gap
  or overlap fails CI.
- The ATC matrix in `withholding.ts` is a representative seed, not the full
  BIR list — extend it with the same row shape.
