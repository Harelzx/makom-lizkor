import { hmacHex } from "./places"
import { attemptMail, type SendMail } from "../lib/mail"
import type { MailOutcome } from "../lib/gmail"
import { verificationMail } from "../lib/messages"
import { sha256Hex, sameHash } from "../lib/ids"
import { log } from "../lib/log"

export type MailAttempt = (env: Env, mail: Parameters<SendMail>[1]) => Promise<MailOutcome>
export const productionAttempt: MailAttempt = (env, mail) => attemptMail(env, mail)
const GAP_MS = 15 * 60_000
const TRIES = 5

/** Durable contact metadata is committed with the submission, before its receipt. No body, address copy or token. */
export async function deliverVerification(env: Env, attempt: MailAttempt, now: Date, placeId?: string) {
  const at = now.toISOString()
  // An interrupted sender may already have been accepted by Gmail. Never automatically reclaim and resend it.
  await env.DB.prepare(
    "UPDATE contacts SET verify_mail_state = 'uncertain' WHERE verify_mail_state = 'sending' AND verify_mail_tried_at <= ?",
  )
    .bind(new Date(now.getTime() - GAP_MS).toISOString())
    .run()
  const rows = (
    await env.DB.prepare(
      `SELECT c.id, c.email, c.email_verify_hash FROM contacts c JOIN places p ON p.id = c.place_id
     WHERE c.verify_mail_state IN ('due', 'retry') AND c.verify_mail_attempts < ?1
     AND c.email IS NOT NULL AND c.email_verified_at IS NULL AND c.email_verify_expires > ?2
     AND c.purge_after > ?2 AND c.ceiling_at > ?2 AND p.status NOT IN ('withdrawn', 'erased')
     AND (?3 IS NULL OR c.place_id = ?3) AND (c.verify_mail_tried_at IS NULL OR c.verify_mail_tried_at <= ?4)
     ORDER BY c.created_at LIMIT 10`,
    )
      .bind(TRIES, at, placeId ?? null, new Date(now.getTime() - GAP_MS).toISOString())
      .all<{ id: string; email: string; email_verify_hash: string }>()
  ).results
  for (const row of rows) {
    const token = await hmacHex(env.TRACKING_SECRET, `verify:${row.id}`)
    // Old random-token contacts have no recoverable delivery metadata and cannot be converted/re-sent by guessing.
    if (!(await sameHash(await sha256Hex(token), row.email_verify_hash))) continue
    const claim = await env.DB.prepare(
      `UPDATE contacts SET verify_mail_state = 'sending', verify_mail_attempts = verify_mail_attempts + 1, verify_mail_tried_at = ?2
       WHERE id = ?1 AND verify_mail_state IN ('due', 'retry') AND verify_mail_attempts < ?3
       AND email_verified_at IS NULL AND purge_after > ?2 AND ceiling_at > ?2 AND email_verify_expires > ?2
       AND EXISTS (SELECT 1 FROM places p WHERE p.id = contacts.place_id AND p.status NOT IN ('withdrawn', 'erased'))
       AND (verify_mail_tried_at IS NULL OR verify_mail_tried_at <= ?4)
       RETURNING verify_mail_attempts AS n`,
    )
      .bind(row.id, at, TRIES, new Date(now.getTime() - GAP_MS).toISOString())
      .first<{ n: number }>()
    if (!claim) continue
    // No request-origin dependency in production; these links always point to the configured origin.
    let outcome: MailOutcome = "uncertain"
    try {
      outcome = await attempt(env, verificationMail(row.email, `${env.PUBLIC_ORIGIN}/#/verify/${token}`))
    } catch {
      /* uncertain */
    }
    const state = outcome === "deferred" ? "retry" : outcome === "retryable" ? (claim.n >= TRIES ? "stopped" : "retry") : outcome
    await env.DB.prepare(
      "UPDATE contacts SET verify_mail_state = ?2, verify_mail_attempts = verify_mail_attempts - ?4 WHERE id = ?1 AND verify_mail_state = 'sending' AND verify_mail_tried_at = ?3",
    )
      .bind(row.id, state, at, Number(outcome === "deferred"))
      .run()
    log(outcome === "accepted" ? "info" : "warn", "verification_delivery", {
      counts: {
        accepted: Number(outcome === "accepted"),
        retryable: Number(outcome === "retryable"),
        uncertain: Number(outcome === "uncertain"),
        stopped: Number(state === "stopped"),
      },
    })
  }
}
