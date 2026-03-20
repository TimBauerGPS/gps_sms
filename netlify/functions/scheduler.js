// Netlify scheduled function — runs daily at 20:00 UTC (12:00 PM PST / 1:00 PM PDT)
// Processes active message_plans for all companies and either sends SMS
// immediately (date_offset plans) or queues them for review (status_change plans).

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Supabase admin client (bypasses RLS via service role key)
// ---------------------------------------------------------------------------
function makeSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------
// Supported placeholders:
//   {{REVIEW_LINK}} — resolved via company.review_links (array of {match_string, url})
//   {{<key>}}       — resolved via job.raw_csv_row[key]
function resolvePlaceholders(template, job, company) {
  // Handle {{REVIEW_LINK}} first
  let result = template.replace(/\{\{REVIEW_LINK\}\}/gi, () => resolveReviewLink(job, company))
  // Handle {{Guardian Office Name}} → company name
  result = result.replace(/\{\{Guardian Office Name\}\}/gi, () => company.name ?? '')
  // Handle other {{placeholders}} from raw_csv_row (case-insensitive key match)
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const raw = job.raw_csv_row ?? {}
    const normalized = key.trim().toLowerCase()
    const found = Object.entries(raw).find(([k]) => k.toLowerCase() === normalized)
    return found ? String(found[1]) : match
  })
  return result
}

function resolveReviewLink(job, company) {
  const links = company.review_links ?? [] // [{match_string, url}]
  const jobName = (job.albi_job_id ?? '') + ' ' + (job.customer_name ?? '')

  let defaultUrl = ''
  for (const entry of links) {
    if (!entry.match_string) {
      // Empty match_string = default fallback; keep looking for a specific match
      defaultUrl = entry.url ?? ''
      continue
    }
    if (jobName.toLowerCase().includes(entry.match_string.toLowerCase())) {
      return entry.url ?? ''
    }
  }
  return defaultUrl
}

// ---------------------------------------------------------------------------
// Job-type filter helper
// ---------------------------------------------------------------------------
// Returns true if the job matches at least one of the trigger_job_type_strings
// (case-insensitive substring match against albi_job_id OR customer_name).
function jobMatchesTypeFilter(job, triggerStrings) {
  if (!triggerStrings || triggerStrings.length === 0) return true
  const haystack = ((job.albi_job_id ?? '') + ' ' + (job.customer_name ?? '')).toLowerCase()
  return triggerStrings.some(s => haystack.includes(s.toLowerCase()))
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
// Returns a UTC date string 'YYYY-MM-DD' for a given Date (or ISO string)
function toUTCDateString(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toISOString().slice(0, 10)
}

const CUTOFF_DATE = '2026-01-01'

function isBeforeCutoff(job) {
  if (!job.created_at_albi) return false
  return job.created_at_albi < CUTOFF_DATE
}

// ---------------------------------------------------------------------------
// Twilio SMS sender
// ---------------------------------------------------------------------------
async function sendTwilioSMS({ sid, token, from, to, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const formBody = new URLSearchParams({ To: to, From: from, Body: body })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }

  const json = await res.json()
  return json.sid // Twilio message SID
}

// ---------------------------------------------------------------------------
// Process a single DATE_OFFSET plan for one company
// ---------------------------------------------------------------------------
async function processDateOffsetPlan(supabase, company, plan) {
  const today = toUTCDateString(new Date())
  const field = plan.trigger_date_field // e.g. 'inspection_date'

  // Fetch jobs that have a non-null value for the trigger date field.
  // We fetch all jobs for the company and filter in JS because Supabase
  // PostgREST doesn't support dynamic column references in filters.
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('company_id', company.id)
    .not(field, 'is', null)

  if (jobsErr) {
    console.error(`[date_offset] jobs fetch error (company=${company.id}, plan=${plan.id}):`, jobsErr)
    return
  }

  // Pre-load do_not_text list for this company
  const { data: dntRows } = await supabase
    .from('do_not_text')
    .select('phone_number')
    .eq('company_id', company.id)
  const doNotTextSet = new Set((dntRows ?? []).map(r => r.phone_number))

  for (const job of jobs ?? []) {
    // Skip jobs predating the cutoff
    if (isBeforeCutoff(job)) continue

    // Job-type filter
    if (!jobMatchesTypeFilter(job, plan.trigger_job_type_strings)) continue

    // Check trigger date + offset is within the 7-day catch-up window
    const rawDate = job[field]
    if (!rawDate) continue
    const triggerDate = new Date(rawDate)
    triggerDate.setUTCDate(triggerDate.getUTCDate() + (plan.trigger_offset_days ?? 0))
    const triggerStr = toUTCDateString(triggerDate)
    if (triggerStr > today) continue // future — not yet
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)
    if (triggerStr < toUTCDateString(sevenDaysAgo)) continue // too old — skip

    // Skip if no phone
    const phone = job.customer_phone
    if (!phone) continue

    // Skip if on do-not-text list
    if (doNotTextSet.has(phone)) continue

    // Skip if already sent for this (job_id, plan_id) combo
    const { data: alreadySent } = await supabase
      .from('sent_messages')
      .select('id')
      .eq('job_id', job.id)
      .eq('plan_id', plan.id)
      .limit(1)
    if (alreadySent && alreadySent.length > 0) continue

    // Skip if already queued OR previously removed (skipped) for this (job, plan)
    const { data: alreadyQueued } = await supabase
      .from('send_queue')
      .select('id')
      .eq('job_id', job.id)
      .eq('plan_id', plan.id)
      .limit(1)
    if (alreadyQueued && alreadyQueued.length > 0) continue

    // Skip if any outbound message already sent to this phone today
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const { data: sentToday } = await supabase
      .from('sent_messages')
      .select('id')
      .eq('to_phone', phone)
      .eq('company_id', company.id)
      .eq('direction', 'outbound')
      .gte('sent_at', todayStart.toISOString())
      .limit(1)
    if (sentToday && sentToday.length > 0) continue

    // Resolve message
    const message = resolvePlaceholders(plan.message_template, job, company)

    if (company.auto_send_enabled) {
      // Auto-send directly via Twilio
      try {
        await sendTwilioSMS({
          sid: company.twilio_account_sid,
          token: company.twilio_auth_token,
          from: company.twilio_phone_number,
          to: phone,
          body: message,
        })
        await supabase.from('sent_messages').insert({
          company_id: company.id,
          job_id: job.id,
          plan_id: plan.id,
          to_phone: phone,
          body: message,
          direction: 'outbound',
          sent_at: new Date().toISOString(),
        })
        console.log(`[date_offset] Auto-sent (job=${job.id}, plan=${plan.id})`)
      } catch (err) {
        console.error(`[date_offset] Twilio send error (job=${job.id}, plan=${plan.id}):`, err)
      }
    } else {
      // Queue for manual review
      const { error: queueErr } = await supabase.from('send_queue').insert({
        company_id: company.id,
        job_id: job.id,
        plan_id: plan.id,
        resolved_message: message,
        status: 'pending',
        queued_at: new Date().toISOString(),
      })
      if (queueErr) {
        console.error(`[date_offset] send_queue insert error (job=${job.id}, plan=${plan.id}):`, queueErr)
      } else {
        console.log(`[date_offset] Queued (job=${job.id}, plan=${plan.id})`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Process a single STATUS_CHANGE plan for one company
// ---------------------------------------------------------------------------
async function processStatusChangePlan(supabase, company, plan) {
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('company_id', company.id)
    .eq('status', plan.trigger_status_value)

  if (jobsErr) {
    console.error(`[status_change] jobs fetch error (company=${company.id}, plan=${plan.id}):`, jobsErr)
    return
  }

  for (const job of jobs ?? []) {
    // Skip jobs predating the cutoff
    if (isBeforeCutoff(job)) continue

    // Job-type filter
    if (!jobMatchesTypeFilter(job, plan.trigger_job_type_strings)) continue

    // Skip if already in sent_messages for this (job_id, plan_id)
    const { data: alreadySent } = await supabase
      .from('sent_messages')
      .select('id')
      .eq('job_id', job.id)
      .eq('plan_id', plan.id)
      .limit(1)
    if (alreadySent && alreadySent.length > 0) continue

    // Skip if already queued OR previously removed (skipped) for this (job, plan)
    const { data: alreadyQueued } = await supabase
      .from('send_queue')
      .select('id')
      .eq('job_id', job.id)
      .eq('plan_id', plan.id)
      .limit(1)
    if (alreadyQueued && alreadyQueued.length > 0) continue

    // Skip if no phone
    const phone = job.customer_phone
    if (!phone) continue

    // Skip if any outbound message already sent to this phone today
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const { data: sentToday } = await supabase
      .from('sent_messages')
      .select('id')
      .eq('to_phone', phone)
      .eq('company_id', company.id)
      .eq('direction', 'outbound')
      .gte('sent_at', todayStart.toISOString())
      .limit(1)
    if (sentToday && sentToday.length > 0) continue

    // Resolve message now (snapshot at queue time)
    const resolvedMessage = resolvePlaceholders(plan.message_template, job, company)

    // Insert into send_queue — user reviews and approves in /send-queue
    const { error: queueErr } = await supabase.from('send_queue').insert({
      company_id: company.id,
      job_id: job.id,
      plan_id: plan.id,
      resolved_message: resolvedMessage,
      status: 'pending',
      queued_at: new Date().toISOString(),
    })
    if (queueErr) {
      console.error(`[status_change] send_queue insert error (job=${job.id}, plan=${plan.id}):`, queueErr)
    } else {
      console.log(`[status_change] Queued (job=${job.id}, plan=${plan.id})`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export const handler = async (event, context) => {
  console.log('[scheduler] Starting daily run at', new Date().toISOString())

  let supabase
  try {
    supabase = makeSupabase()
  } catch (err) {
    console.error('[scheduler] Supabase init failed:', err.message)
    return { statusCode: 500, body: err.message }
  }

  // Fetch all companies
  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('*')

  if (companiesErr) {
    console.error('[scheduler] Failed to fetch companies:', companiesErr)
    return { statusCode: 500, body: 'Failed to fetch companies' }
  }

  for (const company of companies ?? []) {
    console.log(`[scheduler] Processing company: ${company.name} (${company.id})`)

    // Fetch all active plans for this company
    const { data: plans, error: plansErr } = await supabase
      .from('message_plans')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_active', true)

    if (plansErr) {
      console.error(`[scheduler] Failed to fetch plans for company=${company.id}:`, plansErr)
      continue
    }

    for (const plan of plans ?? []) {
      try {
        if (plan.trigger_type === 'date_offset') {
          await processDateOffsetPlan(supabase, company, plan)
        } else if (plan.trigger_type === 'status_change') {
          await processStatusChangePlan(supabase, company, plan)
        } else {
          console.warn(`[scheduler] Unknown trigger_type '${plan.trigger_type}' for plan=${plan.id}`)
        }
      } catch (err) {
        console.error(`[scheduler] Unhandled error processing plan=${plan.id}:`, err)
      }
    }
  }

  console.log('[scheduler] Daily run complete at', new Date().toISOString())
  return { statusCode: 200, body: 'OK' }
}

export const config = {
  schedule: '0 20 * * *',
}
