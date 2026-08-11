# Architecture

## The one rule: everything derives from the TaxProfile

`src/domain/taxProfile.ts` is the single source of truth for how a company is
taxed: entity type, income tax regime, business tax regime, **registered tax
types as a set** (multi-line registration — never an enum), withholding agent
roles, other liabilities, accounting basis, fiscal year end, EOPT
classification. Profiles are versioned (`effectiveFrom`/`effectiveTo`) so a
company can convert from non-VAT to VAT mid-year and history still computes
correctly. `validateTaxProfile` enforces cross-field consistency (e.g. the 8%
option is individuals-only and incompatible with VAT registration).

Downstream consumers never branch on "is this a corporation": they ask the
profile. The tests in `lineTax.test.ts` and `filingCalendar.test.ts` pin this
— the same document produces different postings under different profiles, and
a non-VAT professional can never see a 2550Q.

## Rates and rules as data

`src/tax/rules/` holds every number: VAT rate, percentage-tax rate, income
tax brackets (2018–2022 and 2023+ TRAIN schedules), ATC/EWT matrix,
compensation withholding tables, corporate RCIT/MCIT (CREATE, including the
2020–2023 relief window), DST rates, EOPT thresholds and de minimis caps.
Each table is an array of effectivity blocks; `resolveEffective` picks the
block for the transaction date, and a contiguity test fails the build if a
new block leaves a gap or overlap. Adding a rate change is a data edit plus a
boundary test — see `src/tax/rules/README.md`.

Structural deadline logic (which day-offset each form uses) lives in
`filingCalendar.ts` as code because it is tied to a form's identity, not a
peso value; anything that is a number subject to legislative change lives in
the rules tables (e.g. the 0605 registration fee's EOPT abolition is
rules-driven, which is why 2023 shows the form and 2026 doesn't).

## Money

`src/lib/money.ts`. Amounts are integer **centavos** (safe-integer asserted);
rates are rationals `{num, den}` built by `pct()`/`rate()`. Multiplication
runs through BigInt so intermediates can't lose precision, and rounds
**half-up exactly once** at the points BIR requires (e.g. extracting 12/112
from a VAT-inclusive price). `allocate()` uses largest-remainder so splits
(input-VAT allocation for mixed transactions) never lose a centavo. All of
this is unit-tested, including the `.5`-exactly and negative-mirror cases.

## Ports and adapters

```
        UI (React) ── TanStack Query
              │
        DataPort (src/data/ports/)      ← the only read/write surface
        ┌─────┴──────────────┐
  LocalAdapter          SupabaseAdapter
  (Dexie/IndexedDB)     (stub: throws NotImplemented)
```

- Every repository the app needs is an interface in `src/data/ports/index.ts`.
- The adapter is chosen **once**, in `src/data/index.ts`, from
  `VITE_DATA_ADAPTER`. No Supabase client calls exist anywhere outside
  `src/data/adapters/supabase/SupabaseAdapter.ts` — integration is a one-file
  swap by design.
- `supabase/migrations/0001_init.sql` is authored but **not applied**: full
  schema with `company_id` on every tenant table, BIGINT centavos, a deferred
  trigger enforcing balanced entries, UPDATE/DELETE triggers making the
  ledger append-only in the database, and RLS policy drafts keyed on a
  `company_members` mapping.
- The LocalAdapter enforces the same append-only rules at the storage
  boundary (rejects duplicate entry ids, refuses to mutate posted sheets) —
  defense in depth; the domain layer already refuses to construct bad data.

## Posting: the only path to the ledger

Sheets (9 types: sales invoice/receipt, purchase bill, collection,
disbursement, general journal, payroll register, credit/debit memo) are
drafts until posted. `postSheet` derives taxes per line via the engine, then
`createJournalEntry` — the **only** constructor — validates the double-entry
invariant and deep-freezes the result. There is no update or delete anywhere;
corrections are `reverseEntry` (a new entry, sides swapped, cross-referenced).
The trial balance ties by construction, and `posting.test.ts` proves it over
mixed batches.

Posting resolves accounts two ways, both COA-shape-independent:

- **TaxTag** (`output_vat`, `ewt_payable`, `creditable_wtax_receivable`, …):
  how a line enters tax computations and BIR reports.
- **SystemRole** (`accounts_receivable`, `cash`, `sales`, …): where document
  totals post structurally.

A custom chart of accounts works as long as tags/roles are assigned; reports
never reference account codes.

Period close (`periodClose.ts`): a validation checklist (no drafts in period,
prior periods closed, no orphan entries) must pass before `lockPeriod`; a
lock blocks all further posting into that month via `assertPostingAllowed`,
enforced in the domain, not the UI.

## Tax engine shape

- `deriveVat` — inclusive/exclusive, exempt/zero-rated classes, historical
  rates (a 2005 date computes at 10%).
- `allocateInputVat` — Sec. 110(A)(3) pro-rata for mixed transactions.
- `computeWithholding` — ATC × VAT-exclusive base, two-tier stepping on
  cumulative annual gross (5%/10% professional fees, 10%/15% corporate).
- `computeCompensationWithholding`, `computeFringeBenefitsTax`.
- `computeIndividualIncomeTax` — graduated/OSD/8% (incl. the mixed-income
  earner rule that denies the ₱250k deduction), `computeCorporateIncomeTax`
  — RCIT 25/20 with the CREATE asset/income caps, MCIT from year 4,
  ITH/SCIT/exempt.
- `deriveLineTax`/`deriveDocumentTotals` — the profile-driven façade the UI
  and posting layer call; exempt and zero-rated lines coexist on one
  document, government counterparties trigger the 5% VAT withholding.

## Reports and BIR outputs

- **Books** (`reports/books.ts`): BIR columnar models + builders — general
  journal/ledger, sales & purchase journals (VATable/exempt/zero-rated/VAT
  columns), cash receipts/disbursements. Built from tagged journal lines.
- **Financial statements** (`reports/financialStatements.ts`): income
  statement, balance sheet (unclosed earnings folded into equity so it always
  balances), simplified indirect cash flow.
- **Returns** (`reports/returns/`): typed models for 2550Q, 2551Q, 1701/
  1701A/1701Q, 1702-RT/EX/MX/1702Q, 1601-C/EQ/FQ, 0619-E/F, 1604-C/E/F,
  0605, 2000/2000-OT. Builders are implemented where the numbers fall
  straight out of the ledger (2550Q, 2551Q, 1601-C, 1601-EQ); the income-tax
  series needs year-to-date carry-forward state that arrives with period
  close, so those stay model-only for now. `FORM_REGISTRY.appliesTo(profile)`
  is what makes forms appear/disappear per registration.
- **Attachments** (`reports/attachments/datWriter.ts`): `DatFileWriter<T>`
  interface with typed SLSP/QAP/SAWT/annual-alphalist models; writers throw
  `DatWriterNotImplementedError` until the pipe-delimited layouts land.
  Certificates 2307/2306/2316 are typed models in `reports/certificates.ts`.
- Renderers: `FormRenderer<T>` with a JSON stub so the pipeline is wired
  end-to-end before PDF/eBIRForms formats exist.

## UI

- `/` — original marketing page (own copy and design).
- `/onboarding` — 4-step wizard: company → tax profile questionnaire → COA
  template → master data import (CSV import stubbed). Finishing writes the
  company, profile, and instantiated COA through the DataPort.
- `/app` — shell with company switcher; dashboard renders the FilingCalendar
  for any month plus a live trial balance; sheet pages use a keyboard-first
  grid (Tab across, Enter adds rows, multi-cell paste from Excel via TSV
  clipboard parsing) with live per-line tax derivation; reports page renders
  books/statements and the profile's available forms; close page renders the
  validation checklist and lock.
- GitHub Pages: history-mode routing with the `404.html` redirect technique;
  `base` comes from `BASE_PATH` (set by CI to `/<repo>/`).

## Defaults chosen (and why), for later review

- **Withholding remittances follow calendar quarters** (0619/1601-EQ) even
  for fiscal-year corporations — matches BIR practice; VAT quarters follow
  the taxpayer's fiscal quarter.
- **The 8% election** is modeled as `incomeTaxRegime: 'eight_percent'`; the
  taxpayer stays registered for percentage tax (the election is annual) but
  2551Q generation is suppressed while it's in force.
- **EWT base always excludes VAT**, even when the buyer is non-VAT and books
  the gross as cost.
- **Payroll statutory contributions** (SSS/PhilHealth/Pag-IBIG) are not
  computed yet — their tables belong in `tax/rules/` as another versioned
  table; the payroll register currently posts gross → compensation
  withholding → net, with employer-share accounts already in the COA.
- **Deadline dates are not yet shifted** for weekends/holidays (BIR moves
  them to the next working day); needs a holiday table — same
  effectivity-block pattern.
- **1601-EQ ATC rows** are empty pending the QAP writer (the quarterly total
  is ledger-true); **2550Q** carry-over/allocation fields are zero pending
  period-close state.
- **Sheet numbering**: manual document numbers in the UI; the atomic
  `NumberingRepository.claimNext` exists and is tested, wiring it into the
  sheet form is a small follow-up.
- **Zod 3 + @hookform/resolvers 3** (stable pairing), **Tailwind v4** via the
  Vite plugin, **code-based TanStack Router tree** (no codegen plugin) to
  keep moving parts minimal.
- **ISO date strings** (`YYYY-MM-DD`) everywhere in the domain; no Date
  objects in business logic, so timezones can't shift a transaction across a
  period boundary.

## Where Supabase plugs in

1. Apply `supabase/migrations/0001_init.sql` (review RLS first).
2. Implement `SupabaseAdapter` against the same `DataPort` interfaces —
   mapping is mechanical; `registeredTaxTypes` is `text[]`, journal lines are
   a child table whose balance the DB re-verifies with a deferred trigger.
3. Set `VITE_DATA_ADAPTER=supabase` plus the URL/anon key env vars.
   Nothing else in the app changes; the LocalAdapter remains the offline
   fallback and its tests keep guarding the port contract.
