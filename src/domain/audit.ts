import type { CompanyId } from './core'

/**
 * Audit trail: one row per state transition — what happened, when, by whom
 * (a stub user until auth lands), and before/after snapshots for edits to
 * mutable records (drafts, master data, profiles).
 */

export type AuditAction =
  | 'draft_saved'
  | 'draft_deleted'
  | 'sheet_posted'
  | 'entry_reversed'
  | 'correction_drafted'
  | 'period_locked'
  | 'period_unlocked'
  | 'profile_revised'
  | 'return_generated'
  | 'company_imported'

export interface AuditEvent {
  readonly id: string
  readonly companyId: CompanyId
  readonly at: string // ISO timestamp
  readonly actor: string
  readonly action: AuditAction
  /** What the event is about, e.g. "sheet:SI-0100", "period:2026-03". */
  readonly subject: string
  readonly detail: string
  /** JSON snapshots for edits to mutable records. */
  readonly before?: unknown
  readonly after?: unknown
}

/** The stub identity used until authentication exists. */
export const LOCAL_ACTOR = 'local-user'

export const auditEvent = (
  companyId: CompanyId,
  action: AuditAction,
  subject: string,
  detail: string,
  extra: { before?: unknown; after?: unknown; at?: string; actor?: string } = {},
): AuditEvent => ({
  id: crypto.randomUUID(),
  companyId,
  at: extra.at ?? new Date().toISOString(),
  actor: extra.actor ?? LOCAL_ACTOR,
  action,
  subject,
  detail,
  ...(extra.before !== undefined ? { before: extra.before } : {}),
  ...(extra.after !== undefined ? { after: extra.after } : {}),
})
