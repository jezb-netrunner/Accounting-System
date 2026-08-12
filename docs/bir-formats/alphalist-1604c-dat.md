# 1604-C Annual Alphalist of Employees (.DAT)

> **STATUS: UNVERIFIED.** Do not implement a writer from this file yet.
> Everything below describes what is KNOWN about the format's role and the
> data we already collect; the exact record layout must be transcribed from
> the authoritative source before `verified: true` may be set.

## Consumed by

BIR Alphalist Data Entry module / eSubmission; schedules of the annual information return on compensation.

## Data source (already implemented)

Model: `AnnualAlphalistModel` in `src/reports/attachments/datWriter.ts`. All fields below
are available from the typed model; the open question is serialization only.

## Known data content

- Agent TIN, name, year
- Per employee: TIN, last/first/middle name, gross compensation, non-taxable, taxable, tax withheld, employment from/to dates

## UNVERIFIED — required to finish this spec

- [ ] Delimiter (comma vs pipe) and quoting rules — **UNVERIFIED**
- [ ] Exact field ORDER per record type — **UNVERIFIED**
- [ ] Header / details / control record structures and record-type codes — **UNVERIFIED**
- [ ] Field widths, padding, and truncation rules — **UNVERIFIED**
- [ ] Amount format (decimal places, separators, negative representation) — **UNVERIFIED**
- [ ] TIN and branch-code rendering (with or without dashes; 3- vs 5-digit branch) — **UNVERIFIED**
- [ ] Filename convention — expected roughly `TTTTTTTTTBBB12YYYY 1604C .DAT` — **UNVERIFIED**
- [ ] Character encoding and line endings — **UNVERIFIED**

Fill these from the BIR validation module's bundled layout documentation or
a known-accepted sample, then follow docs/bir-formats/README.md step 3.
