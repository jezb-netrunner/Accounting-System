# BIR electronic file format specs

Each file here is the **layout contract** a writer in
`src/reports/attachments/` reads from. The writers refuse to emit a
submission file while a format is marked **UNVERIFIED** — a guessed
pipe-delimited layout is rejected by the BIR validation modules
(RELIEF, Alphalist Data Entry, eSubmission), and a rejected-but-plausible
file is worse than a loud refusal.

## Verification status

| Format | Spec file | Status |
| --- | --- | --- |
| SLSP (RELIEF .DAT) | [slsp-dat.md](slsp-dat.md) | **UNVERIFIED** |
| QAP (1601-EQ/FQ .DAT) | [qap-dat.md](qap-dat.md) | **UNVERIFIED** |
| SAWT .DAT | [sawt-dat.md](sawt-dat.md) | **UNVERIFIED** |
| 1604-C alphalist .DAT | [alphalist-1604c-dat.md](alphalist-1604c-dat.md) | **UNVERIFIED** |
| 1604-E alphalist .DAT | [alphalist-1604e-dat.md](alphalist-1604e-dat.md) | **UNVERIFIED** |
| 1604-F alphalist .DAT | [alphalist-1604f-dat.md](alphalist-1604f-dat.md) | **UNVERIFIED** |
| eBIRForms XML | [ebirforms-xml.md](ebirforms-xml.md) | **UNVERIFIED** |

## How to verify a format

1. Obtain the authoritative layout: the record structure documentation
   bundled with the BIR validation module (e.g. the RELIEF or Alphalist
   Data Entry installer's `.doc`/`.pdf` layouts), or a known-accepted
   sample file produced by the module itself.
2. Fill in the spec file: exact field order, data types, widths/padding,
   delimiter, header/detail/control record shapes, filename convention,
   and amount formatting (decimal places, thousand separators, signs).
3. Implement the writer in `src/reports/attachments/datWriter.ts` reading
   from the documented layout, flip `verified: true` for the format in
   `src/reports/attachments/formatSpecs.ts`, and un-`fails` the
   corresponding test in `datWriter.test.ts` so the layout is pinned.

Until then, the UI offers **draft CSV** exports of the same data, clearly
bannered as not-for-submission, so figures can still be reviewed.

## Typed models (already final)

The data content of each file is already fixed by the typed models in
`src/reports/attachments/datWriter.ts` (`SlspModel`, `QapModel`,
`SawtModel`, `AnnualAlphalistModel`) — verifying a format is purely a
serialization exercise; no new data collection is needed.
