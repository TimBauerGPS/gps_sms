export const LOST_STATUS = 'lost'
export const LOST_STATUS_SKIP_REASON = 'lost_status_protected'

export function normalizeStatus(status) {
  return String(status ?? '').trim().toLowerCase()
}

export function isLostStatus(status) {
  return normalizeStatus(status) === LOST_STATUS
}

export function hasLostStatus(relatedJobs) {
  return (relatedJobs ?? []).some((job) => isLostStatus(job?.status))
}

export function isLostStatusSpecificSend(sendContext) {
  const jobIsLost = isLostStatus(sendContext?.jobStatus)
  if (!jobIsLost) return false

  if (isLostStatus(sendContext?.planTriggerStatusValue)) return true
  if ((sendContext?.targetStatuses ?? []).some((status) => isLostStatus(status))) return true
  if (sendContext?.allowLostJobDirectSend === true) return true

  return false
}

export function shouldBlockForLostStatus({ relatedJobs, sendContext }) {
  if (!hasLostStatus(relatedJobs)) return { blocked: false }
  if (isLostStatusSpecificSend(sendContext)) return { blocked: false }

  return {
    blocked: true,
    reason: LOST_STATUS_SKIP_REASON,
  }
}
