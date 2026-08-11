import {
  addDays,
  addMonths,
  fiscalQuarterOf,
  periodEnd,
  periodOfDate,
  periodStart,
  type ISODate,
  type Period,
} from '../domain/core'
import { isIndividualType, type TaxProfile } from '../domain/taxProfile'
import { rules } from './rules'

/**
 * FilingCalendar: profile + period → the BIR obligations due, with deadlines.
 * Which forms appear derives entirely from the tax profile — a non-VAT
 * professional never sees a 2550Q — and every date is computed, never typed.
 *
 * Deadline structure (which day-offset each form uses) is statutory and tied
 * to the form's identity, so it lives here as named constants; peso values
 * and rates stay in src/tax/rules/.
 */

export interface FilingObligation {
  readonly formCode: string
  readonly description: string
  readonly frequency: 'monthly' | 'quarterly' | 'annual'
  readonly periodCovered: { readonly from: ISODate; readonly to: ISODate }
  readonly deadline: ISODate
  /** Attachments due with the return (SLSP, QAP, SAWT, alphalists…). */
  readonly attachments: readonly string[]
}

const day = (year: number, month: number, d: number): ISODate =>
  `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const lastDayOfMonthAfter = (p: Period): ISODate => periodEnd(addMonths(p, 1))

/** Is `p` the last month of a fiscal quarter for this fiscal-year-end month? */
const isFiscalQuarterEnd = (p: Period, fyEndMonth: number): boolean =>
  (p.month - fyEndMonth + 12) % 3 === 0

/**
 * All obligations whose *deadline* falls inside `period`. This is what a
 * calendar month view renders and what the close checklist consults.
 */
export function filingCalendar(profile: TaxProfile, period: Period): FilingObligation[] {
  const from = periodStart(period)
  const to = periodEnd(period)
  // Deadlines shown in month P always arise from periods ending within the
  // previous 13 months (the longest gap is the annual return).
  const candidates: FilingObligation[] = []
  for (let back = 0; back <= 13; back++) {
    candidates.push(...obligationsArisingFrom(profile, addMonths(period, -back)))
  }
  const seen = new Set<string>()
  return candidates
    .filter((o) => o.deadline >= from && o.deadline <= to)
    .filter((o) => {
      const key = `${o.formCode}|${o.periodCovered.from}|${o.periodCovered.to}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.formCode.localeCompare(b.formCode))
}

/**
 * Obligations *arising from* activity in month `p` (their deadlines fall in
 * later months). The month view above filters these by deadline.
 */
export function obligationsArisingFrom(profile: TaxProfile, p: Period): FilingObligation[] {
  const out: FilingObligation[] = []
  const reg = profile.registeredTaxTypes
  const monthEnd = periodEnd(p)
  const individual = isIndividualType(profile.entityType)
  const fyEnd = profile.fiscalYearEndMonth
  const quarterEnd = isFiscalQuarterEnd(p, fyEnd)
  const fq = fiscalQuarterOf(monthEnd, fyEnd)
  const monthCovered = { from: periodStart(p), to: monthEnd }
  const quarterCovered = { from: fq.startDate, to: fq.endDate }

  // ---- VAT: 2550Q within 25 days after the close of the taxable quarter ----
  if (reg.has('vat') && quarterEnd) {
    out.push({
      formCode: '2550Q',
      description: 'Quarterly value-added tax return',
      frequency: 'quarterly',
      periodCovered: quarterCovered,
      deadline: addDays(fq.endDate, 25),
      attachments: ['SLSP (Summary List of Sales and Purchases)'],
    })
  }

  // ---- Percentage tax: 2551Q within 25 days after the quarter ----
  if (reg.has('percentage_tax') && profile.incomeTaxRegime !== 'eight_percent' && quarterEnd) {
    out.push({
      formCode: '2551Q',
      description: 'Quarterly percentage tax return',
      frequency: 'quarterly',
      periodCovered: quarterCovered,
      deadline: addDays(fq.endDate, 25),
      attachments: [],
    })
  }

  // ---- Income tax ----
  if (reg.has('income_tax')) {
    if (individual) {
      // 1701Q for Q1-Q3 (fixed statutory dates), annual 1701/1701A Apr 15.
      const qDeadlines: Record<number, ISODate> = {
        3: day(p.year, 5, 15),
        6: day(p.year, 8, 15),
        9: day(p.year, 11, 15),
      }
      if (p.month in qDeadlines && profile.incomeTaxRegime !== 'exempt') {
        out.push({
          formCode: '1701Q',
          description: 'Quarterly income tax return (individuals)',
          frequency: 'quarterly',
          periodCovered: { from: day(p.year, 1, 1), to: monthEnd },
          deadline: qDeadlines[p.month]!,
          attachments: ['SAWT (creditable withholding claimed)'],
        })
      }
      if (p.month === 12) {
        const pureBusinessSimple =
          profile.entityType !== 'mixed_income_individual' &&
          (profile.incomeTaxRegime === 'eight_percent' || profile.incomeTaxRegime === 'graduated_osd')
        out.push({
          formCode: pureBusinessSimple ? '1701A' : '1701',
          description: 'Annual income tax return (individuals)',
          frequency: 'annual',
          periodCovered: { from: day(p.year, 1, 1), to: monthEnd },
          deadline: day(p.year + 1, 4, 15),
          attachments: ['SAWT', 'Financial statements (if gross > audit threshold)'],
        })
      }
    } else {
      // Corporations: 1702Q within 60 days of Q1-Q3 close; annual 1702 on the
      // 15th day of the 4th month after fiscal year end.
      if (quarterEnd && fq.quarter !== 4 && profile.incomeTaxRegime !== 'exempt') {
        out.push({
          formCode: '1702Q',
          description: 'Quarterly income tax return (corporations)',
          frequency: 'quarterly',
          periodCovered: quarterCovered,
          deadline: addDays(fq.endDate, 60),
          attachments: ['SAWT (creditable withholding claimed)'],
        })
      }
      if (p.month === fyEnd) {
        const variant =
          profile.incomeTaxRegime === 'exempt' || profile.incomeTaxRegime === 'income_tax_holiday'
            ? '1702-EX'
            : profile.incomeTaxRegime === 'special_rate_incentive' || profile.incentive
              ? '1702-MX'
              : '1702-RT'
        const fyStart = periodStart(addMonths(p, -11))
        out.push({
          formCode: variant,
          description: 'Annual income tax return (corporations)',
          frequency: 'annual',
          periodCovered: { from: fyStart, to: monthEnd },
          deadline: day(addMonths(p, 4).year, addMonths(p, 4).month, 15),
          attachments: ['Audited financial statements', 'SAWT', '1709 (related-party, if applicable)'],
        })
      }
    }
  }

  // ---- Expanded withholding: 0619-E (months 1-2), 1601-EQ (quarter), 1604-E ----
  if (reg.has('withholding_expanded')) {
    const calendarQuarterEnd = p.month % 3 === 0 // withholding follows calendar quarters
    if (!calendarQuarterEnd) {
      out.push({
        formCode: '0619-E',
        description: 'Monthly remittance of creditable income tax withheld',
        frequency: 'monthly',
        periodCovered: monthCovered,
        deadline: day(addMonths(p, 1).year, addMonths(p, 1).month, 10),
        attachments: [],
      })
    } else {
      out.push({
        formCode: '1601-EQ',
        description: 'Quarterly remittance return of creditable income tax withheld',
        frequency: 'quarterly',
        periodCovered: { from: periodStart(addMonths(p, -2)), to: monthEnd },
        deadline: lastDayOfMonthAfter(p),
        attachments: ['QAP (Quarterly Alphalist of Payees)'],
      })
    }
    if (p.month === 12) {
      out.push({
        formCode: '1604-E',
        description: 'Annual information return of creditable income taxes withheld',
        frequency: 'annual',
        periodCovered: { from: day(p.year, 1, 1), to: monthEnd },
        deadline: day(p.year + 1, 3, 1),
        attachments: ['Annual alphalist of payees'],
      })
    }
  }

  // ---- Final withholding: 0619-F, 1601-FQ, 1604-F ----
  if (reg.has('withholding_final')) {
    const calendarQuarterEnd = p.month % 3 === 0
    if (!calendarQuarterEnd) {
      out.push({
        formCode: '0619-F',
        description: 'Monthly remittance of final income tax withheld',
        frequency: 'monthly',
        periodCovered: monthCovered,
        deadline: day(addMonths(p, 1).year, addMonths(p, 1).month, 10),
        attachments: [],
      })
    } else {
      out.push({
        formCode: '1601-FQ',
        description: 'Quarterly remittance return of final income tax withheld',
        frequency: 'quarterly',
        periodCovered: { from: periodStart(addMonths(p, -2)), to: monthEnd },
        deadline: lastDayOfMonthAfter(p),
        attachments: ['QAP'],
      })
    }
    if (p.month === 12) {
      out.push({
        formCode: '1604-F',
        description: 'Annual information return of final income taxes withheld',
        frequency: 'annual',
        periodCovered: { from: day(p.year, 1, 1), to: monthEnd },
        deadline: day(p.year + 1, 1, 31),
        attachments: ['Annual alphalist of payees (final)'],
      })
    }
  }

  // ---- Compensation withholding: 1601-C monthly, 1604-C + 2316 annually ----
  if (reg.has('withholding_compensation')) {
    // December's 1601-C gets until Jan 15; other months the 10th.
    const next = addMonths(p, 1)
    out.push({
      formCode: '1601-C',
      description: 'Monthly remittance return of income taxes withheld on compensation',
      frequency: 'monthly',
      periodCovered: monthCovered,
      deadline: day(next.year, next.month, p.month === 12 ? 15 : 10),
      attachments: [],
    })
    if (p.month === 12) {
      out.push({
        formCode: '1604-C',
        description: 'Annual information return of income taxes withheld on compensation',
        frequency: 'annual',
        periodCovered: { from: day(p.year, 1, 1), to: monthEnd },
        deadline: day(p.year + 1, 1, 31),
        attachments: ['Alphalist of employees', 'BIR 2316 issued to employees'],
      })
    }
  }

  // ---- DST: 2000 within 5 days after the close of the month ----
  if (reg.has('documentary_stamp_tax')) {
    const next = addMonths(p, 1)
    out.push({
      formCode: '2000',
      description: 'Documentary stamp tax declaration/return',
      frequency: 'monthly',
      periodCovered: monthCovered,
      deadline: day(next.year, next.month, 5),
      attachments: [],
    })
  }

  // ---- FBT: 1603Q, last day of the month after the calendar quarter ----
  if (reg.has('fringe_benefits_tax') && p.month % 3 === 0) {
    out.push({
      formCode: '1603Q',
      description: 'Quarterly remittance return of final tax on fringe benefits',
      frequency: 'quarterly',
      periodCovered: { from: periodStart(addMonths(p, -2)), to: monthEnd },
      deadline: lastDayOfMonthAfter(p),
      attachments: [],
    })
  }

  // ---- Annual registration fee (0605) — data-driven; EOPT abolished it ----
  if (p.month === 1 && rules.thresholds(monthEnd).annualRegistrationFeeCentavos !== null) {
    out.push({
      formCode: '0605',
      description: 'Annual registration fee (₱500)',
      frequency: 'annual',
      periodCovered: { from: day(p.year, 1, 1), to: day(p.year, 12, 31) },
      deadline: day(p.year, 1, 31),
      attachments: [],
    })
  }

  return out
}
