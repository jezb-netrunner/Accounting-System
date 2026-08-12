# QAP — Quarterly Alphalist of Payees (.DAT)

> **STATUS: UNVERIFIED.** Do not implement a writer from this file yet.
> Everything below describes what is KNOWN about the format's role and the
> data we already collect; the exact record layout must be transcribed from
> the authoritative source before `verified: true` may be set.

## Consumed by

BIR Alphalist Data Entry module / eSubmission; attached to 1601-EQ (expanded) and 1601-FQ (final).

## Data source (already implemented)

Model: `QapModel` in `src/reports/attachments/datWriter.ts`. All fields below
are available from the typed model; the open question is serialization only.

## Known data content

- Withholding agent TIN and name, quarter end, track (EQ/FQ)
- Per payee per ATC: payee TIN, registered name, ATC, income payment, rate %, tax withheld

## UNVERIFIED — required to finish this spec

- [ ] Delimiter (comma vs pipe) and quoting rules — **UNVERIFIED**
- [ ] Exact field ORDER per record type — **UNVERIFIED**
- [ ] Header / details / control record structures and record-type codes — **UNVERIFIED**
- [ ] Field widths, padding, and truncation rules — **UNVERIFIED**
- [ ] Amount format (decimal places, separators, negative representation) — **UNVERIFIED**
- [ ] TIN and branch-code rendering (with or without dashes; 3- vs 5-digit branch) — **UNVERIFIED**
- [ ] Filename convention — expected roughly `TTTTTTTTTBBBMMYYYY QAP .DAT` — **UNVERIFIED**
- [ ] Character encoding and line endings — **UNVERIFIED**

Fill these from the BIR validation module's bundled layout documentation or
a known-accepted sample, then follow docs/bir-formats/README.md step 3.
