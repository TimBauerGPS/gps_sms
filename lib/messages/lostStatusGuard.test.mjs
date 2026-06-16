import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LOST_STATUS_SKIP_REASON,
  hasLostStatus,
  isLostStatusSpecificSend,
  shouldBlockForLostStatus,
} from './lostStatusGuard.js'

test('detects Lost status with case-insensitive trimming', () => {
  assert.equal(hasLostStatus([{ status: ' lost ' }]), true)
  assert.equal(hasLostStatus([{ status: 'Closed' }, { status: 'LOST' }]), true)
  assert.equal(hasLostStatus([{ status: 'Lost Lead' }]), false)
  assert.equal(hasLostStatus([{ status: null }]), false)
})

test('allows only sends that are specifically for Lost customers', () => {
  assert.equal(
    isLostStatusSpecificSend({
      jobStatus: 'Lost',
      planTriggerStatusValue: 'Lost',
    }),
    true
  )
  assert.equal(
    isLostStatusSpecificSend({
      jobStatus: 'Lost',
      targetStatuses: ['Active', 'Lost'],
    }),
    true
  )
  assert.equal(
    isLostStatusSpecificSend({
      jobStatus: 'Lost',
      allowLostJobDirectSend: true,
    }),
    true
  )
  assert.equal(
    isLostStatusSpecificSend({
      jobStatus: 'Lost',
      planTriggerStatusValue: 'Closed',
    }),
    false
  )
  assert.equal(
    isLostStatusSpecificSend({
      jobStatus: 'Active',
      planTriggerStatusValue: 'Lost',
    }),
    false
  )
})

test('blocks non-Lost-specific texts when any customer job is Lost', () => {
  const result = shouldBlockForLostStatus({
    relatedJobs: [{ status: 'Active' }, { status: 'Lost' }],
    sendContext: { jobStatus: 'Active' },
  })

  assert.deepEqual(result, {
    blocked: true,
    reason: LOST_STATUS_SKIP_REASON,
  })
})

test('does not block when no related customer job is Lost or send is Lost-specific', () => {
  assert.deepEqual(
    shouldBlockForLostStatus({
      relatedJobs: [{ status: 'Active' }],
      sendContext: { jobStatus: 'Active' },
    }),
    { blocked: false }
  )

  assert.deepEqual(
    shouldBlockForLostStatus({
      relatedJobs: [{ status: 'Lost' }],
      sendContext: { jobStatus: 'Lost', planTriggerStatusValue: 'Lost' },
    }),
    { blocked: false }
  )
})
