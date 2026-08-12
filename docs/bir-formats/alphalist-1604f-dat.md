# 1604-F Annual Alphalist (.DAT)

> **STATUS: UNVERIFIED.** Do not implement a writer from this file yet.
> Everything below describes what is KNOWN about the format's role and the
> data we already collect; the exact record layout must be transcribed from
> the authoritative source before `verified: true` may be set.

## Consumed by

BIR Alphalist Data Entry module / eSubmission; annual final-withholding schedules.

## Data source (already implemented)

Model: `AnnualAlphalistModel / Form1604 rows` in `src/reports/attachments/datWriter.ts`. All fields below
are available from the typed model; the open question is serialization only.

## Known data content

- Agent TIN, name, year
- Per payee: TIN, registered name, ATC, tax base, rate %, tax withheld

## UNVERIFIED — required to finish this spec

- [ ] Delimiter (comma vs pipe) and quoting rules — **UNVERIFIED**
- [ ] Exact field ORDER per record type — **UNVERIFIED**
- [ ] Header / details / control record structures and record-type codes — **UNVERIFIED**
- [ ] Field widths, padding, and truncation rules — **UNVERIFIED**
- [ ] Amount format (decimal places, separators, negative representation) — **UNVERIFIED**
- [ ] TIN and branch-code rendering (with or without dashes; 3- vs 5-digit branch) — **UNVERIFIED**
- [ ] Filename convention — expected roughly `TTTTTTTTTBBB12YYYY 1604F .DAT` — **UNVERIFIED**
- [ ] Character encoding and line endings — **UNVERIFIED**

Fill these from the BIR validation module's bundled layout documentation or
a known-accepted sample, then follow docs/bir-formats/README.md step 3.
