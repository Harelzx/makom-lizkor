/**
 * Who runs the site, how to reach them, who processes data for them and how long it is kept: the one place these are
 * set, for the notices, the About page and, later, the server's retention jobs. A value in [brackets], a null, or
 * `verified: false` is fine while developing, but `npm run release:check` fails on any of them, so the notices can't
 * go public with a placeholder or a promise nobody has tested. See docs/compliance-plan.md.
 */

// The privacy notices must name whoever controls the data (Privacy Protection Law s.11(2א)), and the email receives
// corrections and takedown requests.
export const OPERATOR = { name: "[שם המפעיל]", email: "contact@example.org" }

// The project's own managed mailbox. Its provider holds the mail people send us, so the notices name it. The owner
// chose a per-message rule (5.10): each message is kept at most `maxMonths` from receipt, or from sending for our own,
// and deleted earlier where required. The provider's trash and admin recovery add a tail on top. Nothing here promises
// deletion at case closure: the mailbox doesn't do that. `verified` waits for the policy to be configured on the real
// tenant and its tail measured.
export const MAILBOX = {
  provider: "[ספק הדואר]",
  storedIn: "[מדינת האחסון]",
  maxMonths: 12,
  deletionTailDays: null as number | null,
  verified: false,
}

// Where the site itself is served from; its logs see visitors' IP addresses.
export const HOSTING = { provider: "Cloudflare" }

// Provisional until the architecture's deletion and backup jobs are tested end to end, restore drills included.
export const RETENTION = {
  /** contact details, report text and moderator notes, after the case closes */
  contactAfterCloseDays: 90,
  /** and never longer than this after they were given, closed or not */
  contactMaxMonths: 12,
  /** how long a deletion takes to leave our own backups and exports */
  backupTailDays: 37,
  /** the drill database's Time Travel window, the provider's and not shortenable. On its own it bounds nothing; the
   * backend spec's timeline (section 7) derives drill copies gone by deletion + 32 days and exports by + 37, provided
   * a drill loads only the newest export, which the code enforces. Unproven until the end-to-end test sets `verified` */
  restoreDrillCopyDays: 30 as number | null,
  /** the two codes a removal request keeps to catch abuse (one from the network address, one from the explanation): the
   * job clears them once this much has passed since the request came */
  reportAbuseCodeHours: 24,
  /** what the notice promises for them: the job's hours plus room for a late run (every 15 minutes in production) */
  reportAbuseCodeMaxHours: 25,
  /** a removal request kept in the visitor's own browser for a resend, from its first try, until what happened to it
   * is known; never longer. Past it the request is cleared in an open page, or on the next visit if the site was closed */
  reportOutboxHours: 24,
  /** a submission returned for a correction and not corrected: erased this many days after it was returned */
  returnedDays: 30,
  /** a refused submission's text (its photo goes at once): erased this many days after the refusal */
  rejectedTextDays: 30,
  /** a photo that wasn't approved */
  rejectedPhotoDays: 30,
  /** anemone count rows: the daily code, the place, the day and the time */
  tributeDays: 8,
  /** the audit trail (who decided what, when; never a value): kept this long, pending legal approval (spec 7) */
  auditMonths: 24,
  /** an unapproved photo waiting this long reminds the moderators, daily, to decide (spec 7: the moderation target) */
  reviewReminderDays: 14,
  verified: false,
}

/** Privacy Protection (Access) Regulations: an answer to a request to see one's data within 30 days. */
export const ACCESS_RESPONSE_DAYS = 30

export const CONTACT_EMAIL = OPERATOR.email
export const LAST_UPDATED = "2026-10-05"

/**
 * What the notices already promise but the code doesn't do yet. Publishing with any of these would be publishing a
 * false statement, so `npm run release:check` fails while the list isn't empty. Remove an entry only in the commit
 * that implements it, with its test.
 */
export const PENDING_PROMISES: string[] = [
  "a returned submission not corrected within 30 days is erased (phase 5)",
  "anemone count rows are deleted after RETENTION.tributeDays (phase 5)",
  "a photo file whose deletion failed on withdrawal or rejection is swept from storage (phase 5)",
  // The purge call is built (phase 4: one per change, tags feed, tributes and place:<id>); what remains is seeing the
  // edge drop the share page and the photo on staging, and measuring how long it takes.
  "a withdrawn, erased or hidden place's share page and photo are purged from the edge cache (Cache-Tag place:<id>; verified on staging)",
]
