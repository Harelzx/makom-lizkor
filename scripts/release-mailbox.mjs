// Operational mailbox evidence is separate from Google's physical storage and deletion practices.
export function mailboxBlockers(mailbox, receipt, address) {
  const blockers = []
  if (!mailbox.verified) blockers.push("MAILBOX.verified is false: the real per-message rule and scheduled trigger have not been verified")
  if (
    receipt?.format !== 1 ||
    receipt.mailbox !== address ||
    receipt.configuration?.maxMonths !== mailbox.maxMonths ||
    receipt.configuration?.unit !== "message" ||
    receipt.configuration?.triggerCount !== 1 ||
    receipt.configuration?.triggerHours !== 1
  )
    blockers.push("Mailbox configuration does not match the reviewed real-mailbox receipt")
  const execution = receipt?.actualExecution
  if (
    execution?.type !== "time-driven" ||
    execution.manual !== false ||
    execution.status !== "completed" ||
    !Number.isFinite(Date.parse(execution.startedAt))
  )
    blockers.push("Mailbox receipt lacks a completed actual scheduled execution")
  const fixture = receipt?.fixture
  if (
    fixture?.fixtureVerified !== true ||
    fixture.eligible !== 1 ||
    fixture.trashed !== 1 ||
    fixture.oldTrashed !== true ||
    fixture.recentKept !== true ||
    fixture.sameThread !== true ||
    fixture.permanentDeletion !== false ||
    fixture.mailSent !== false ||
    !Number.isFinite(Date.parse(fixture.at))
  )
    blockers.push("Mailbox receipt lacks the old-message/new-reply retention proof")
  if (
    mailbox.trashTailBasis !== "provider_policy" ||
    receipt?.providerTrash?.basis !== "provider_policy" ||
    mailbox.deletionTailDays !== receipt.providerTrash.days ||
    receipt.providerTrash.days !== 30 ||
    receipt.providerTrash.source !== "https://support.google.com/mail/answer/7401" ||
    mailbox.physicalDeletionVerified !== false ||
    receipt.physicalDeletionVerified !== false
  )
    blockers.push("Mailbox trash window must be documented provider policy, with physical deletion explicitly unverified")
  if (!(receipt?.evidence?.length >= 4) || receipt.evidence.some((e) => !/^[a-f0-9]{64}$/.test(e.sha256)))
    blockers.push("Mailbox receipt lacks preserved evidence hashes")
  return blockers
}
