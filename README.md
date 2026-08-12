# PH Books

Double-entry bookkeeping and BIR tax filing for Philippine businesses —
**entity- and tax-type agnostic by construction**. Nothing about VAT, sole
proprietorships, or any single regime is hardcoded: everything derives from a
`TaxProfile` resolved at company setup, and all rates/thresholds live in
versioned rule tables keyed by effectivity date.

> **Status: working application, offline-first.** The tax engine (VAT with
> carry-forward and capital-goods amortization, expanded/final/compensation
> withholding, graduated/OSD/8% and RCIT/MCIT with NOLCO), profile-driven
> onboarding, master data with bulk import, spreadsheet sheet entry, the
> append-only posting engine with reversal/correction, subsidiary ledgers and
> aging, BIR books with print views, comparative financial statements with
> drill-through, returns with carry-forward state and certificates, period
> close with blocker/warning checks, and whole-company JSON portability are
> implemented over the local (IndexedDB) adapter. The BIR `.DAT`/XML file
> layouts are deliberately gated as **UNVERIFIED** (see
> [docs/bir-formats/](docs/bir-formats/README.md)) and the Supabase adapter
> remains a stub behind the same ports. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (unit + integration incl. the end-to-end flow)
npm run build      # tsc -b (strict) + vite build → dist/
```

On first launch the app offers to **load three demo companies**, chosen to
make the profile-driven differences visible immediately:

| Company | Profile | What you'll see |
| --- | --- | --- |
| Narra Trading Corp. | VAT domestic corporation, RCIT, payroll | Output/input VAT, EWT on rent, compensation withholding, 2550Q + 1601-C/EQ + 1702-RT calendar |
| Reyes Dental Clinic | Self-employed professional, 8% option, non-VAT | No VAT anywhere, no 2551Q (suppressed by the 8% election), 1701A annual |
| Aling Nena's Store | Sole proprietor, graduated + OSD, percentage tax | 2551Q quarterly, EWT as agent, no VAT accounts touched |

## Project map

```
src/
  lib/money.ts          Money as integer centavos; rational rates; half-up rounding
  tax/rules/            Versioned rule tables (VAT, %, brackets, ATC, DST, thresholds) + README
  tax/engine/           VAT, withholding, income tax, percentage tax, DST, per-line derivation
  tax/filingCalendar.ts Profile + period → obligations due, with computed deadlines
  domain/               TaxProfile, COA, sheets, append-only posting, ledger, period close
  data/ports/           Repository interfaces — the only way anything reads/writes
  data/adapters/        LocalAdapter (Dexie/IndexedDB) · SupabaseAdapter (stub)
  reports/              Books of accounts, financial statements, BIR return models,
                        .DAT writers (SLSP/QAP/SAWT/alphalists), 2307/2306/2316 models
  seed/                 COA template, demo profiles, demo companies
  ui/                   Marketing page, onboarding wizard, app shell, sheet grids
supabase/migrations/    0001_init.sql — full schema + RLS drafts (authored, NOT applied)
```

## Configuration

Copy `.env.example` to `.env`:

```
VITE_DATA_ADAPTER=local     # local (IndexedDB, offline) | supabase (stub for now)
```

## Deploying to GitHub Pages

The repo ships a workflow (`.github/workflows/deploy.yml`) that tests, builds,
and deploys on every push to `main`.

1. In the repo settings, set **Pages → Source → GitHub Actions** (one-time).
2. Push to `main`. The workflow builds with `BASE_PATH=/<repo-name>/` so the
   Vite `base` matches the Pages subpath automatically.
3. Deep links work without hash routing: `public/404.html` bounces unknown
   paths back to `index.html` with the original URL restored before the
   router boots.

Forks with a different repository name need no config change — the workflow
derives `BASE_PATH` from the repo name.

## Testing

- `npm test` — full suite (engine, rules integrity, posting invariants,
  filing calendar, adapters over `fake-indexeddb`, report builders, seeds).
- `npm run test:watch` — watch mode.
- Rule tables are covered by contiguity tests: a new effectivity block that
  leaves a gap or overlap fails CI. How to add a block:
  [src/tax/rules/README.md](src/tax/rules/README.md).

## What is deliberately not here yet

- **BIR `.DAT` and eBIRForms XML layouts** — the writers refuse to emit
  submission files until the authoritative field layouts are transcribed
  into [docs/bir-formats/](docs/bir-formats/README.md) (each spec carries
  explicit UNVERIFIED markers and a deliberately-failing test). Draft CSVs
  with a not-for-submission banner carry the same data for review.
- Supabase: the adapter throws `NotImplemented`; the SQL schema and RLS
  drafts are authored in `supabase/migrations/0001_init.sql` but **not applied**.
- SSS/PhilHealth/Pag-IBIG contribution *tables* (employee-share amounts are
  keyed on the payroll register; the computed tables are a planned versioned
  rules table) and holiday-aware deadline shifting.
