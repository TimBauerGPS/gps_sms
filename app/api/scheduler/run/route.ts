import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlaceholders } from '@/lib/resolvePlaceholders'
import type { Json } from '@/lib/supabase/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUTOFF_DATE = '2026-01-01'

function toUTCDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isBeforeCutoff(job: Record<string, unknown>): boolean {
  const d = job.created_at_albi as string | null
  if (!d) return false
  return d < CUTOFF_DATE
}

function jobMatchesTypeFilter(
  job: Record<string, unknown>,
  triggerStrings: string[] | null
): boolean {
  if (!triggerStrings?.length) return true
  const haystack = (
    (job.albi_job_id as string ?? '') +
    ' ' +
    (job.customer_name as string ?? '')
  ).toLowerCase()
  return triggerStrings.some((s) => haystack.includes(s.toLowerCase()))
}

interface ReviewLink {
  match_string: string
  url: string
}

function parseReviewLinks(raw: Json): ReviewLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'url' in item) {
      return [{
        match_string: String((item as Record<string, unknown>).match_string ?? ''),
        url: String((item as Record<string, unknown>).url ?? ''),
      }]
    }
    return []
  })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST() {
  // Auth check — must be signed in
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User record not found' }, { status: 401 })

  const admin = createAdminClient()
  const company_id = userRow.company_id
  const today = toUTCDateString(new Date())

  // Fetch company
  const { data: company } = await admin
    .from('companies')
    .select('*')
    .eq('id', company_id)
    .single()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

  const reviewLinks = parseReviewLinks(company.review_links)
  const companyName = company.name as string

  // Fetch active plans
  const { data: plans } = await admin
    .from('message_plans')
    .select('*')
    .eq('company_id', company_id)
    .eq('is_active', true)

  // Fetch DNT list
  const { data: dntRows } = await admin
    .from('do_not_text')
    .select('phone_number')
    .eq('company_id', company_id)
  const doNotTextSet = new Set((dntRows ?? []).map((r) => r.phone_number))

  let queued = 0
  let skipped = 0

  for (const plan of plans ?? []) {
    // Fetch matching jobs
    let jobsQuery = admin.from('jobs').select('*').eq('company_id', company_id)

    if (plan.trigger_type === 'status_change' && plan.trigger_status_value) {
      jobsQuery = jobsQuery.eq('status', plan.trigger_status_value)
    }

    const { data: jobs } = await jobsQuery

    for (const job of jobs ?? []) {
      if (isBeforeCutoff(job as Record<string, unknown>)) { skipped++; continue }
      if (!jobMatchesTypeFilter(job as Record<string, unknown>, plan.trigger_job_type_strings)) { skipped++; continue }

      // Date offset: check if trigger date + offset is within 7-day catch-up window
      if (plan.trigger_type === 'date_offset') {
        const field = plan.trigger_date_field as string
        const rawDate = (job as Record<string, unknown>)[field] as string | null
        if (!rawDate) { skipped++; continue }
        const triggerDate = new Date(rawDate)
        triggerDate.setUTCDate(triggerDate.getUTCDate() + (plan.trigger_offset_days ?? 0))
        const triggerStr = toUTCDateString(triggerDate)
        if (triggerStr > today) { skipped++; continue } // future
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)
        if (triggerStr < toUTCDateString(sevenDaysAgo)) { skipped++; continue } // too old
      }

      const phone = job.customer_phone
      if (!phone) { skipped++; continue }
      if (doNotTextSet.has(phone)) { skipped++; continue }

      // Skip if already sent
      const { data: alreadySent } = await admin
        .from('sent_messages')
        .select('id')
        .eq('job_id', job.id)
        .eq('plan_id', plan.id)
        .limit(1)
      if (alreadySent?.length) { skipped++; continue }

      // Skip if already queued OR previously removed (skipped) for this (job, plan)
      const { data: alreadyQueued } = await admin
        .from('send_queue')
        .select('id')
        .eq('job_id', job.id)
        .eq('plan_id', plan.id)
        .limit(1)
      if (alreadyQueued?.length) { skipped++; continue }

      // Skip if any outbound message already sent to this phone today
      const todayStart = new Date()
      todayStart.setUTCHours(0, 0, 0, 0)
      const { data: sentToday } = await admin
        .from('sent_messages')
        .select('id')
        .eq('to_phone', phone)
        .eq('company_id', company_id)
        .eq('direction', 'outbound')
        .gte('sent_at', todayStart.toISOString())
        .limit(1)
      if (sentToday?.length) { skipped++; continue }

      // Resolve message
      const rawCsvRow =
        job.raw_csv_row && typeof job.raw_csv_row === 'object' && !Array.isArray(job.raw_csv_row)
          ? (job.raw_csv_row as Record<string, string>)
          : {}

      const resolvedMessage = resolvePlaceholders(
        plan.message_template,
        rawCsvRow,
        reviewLinks,
        job.albi_job_id,
        companyName
      )

      const isDateOffset = plan.trigger_type === 'date_offset'

      if (isDateOffset && company.auto_send_enabled) {
        // Auto-send via Twilio
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${company.twilio_account_sid}/Messages.json`
        const authHeader =
          'Basic ' +
          Buffer.from(`${company.twilio_account_sid}:${company.twilio_auth_token}`).toString('base64')
        try {
          const twilioRes = await fetch(twilioUrl, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              To: phone,
              From: company.twilio_phone_number ?? '',
              Body: resolvedMessage,
            }),
          })
          if (!twilioRes.ok) throw new Error(`Twilio ${twilioRes.status}`)
          await admin.from('sent_messages').insert({
            company_id,
            job_id: job.id,
            plan_id: plan.id,
            to_phone: phone,
            from_phone: company.twilio_phone_number ?? '',
            body: resolvedMessage,
            direction: 'outbound',
            sent_at: new Date().toISOString(),
          })
          queued++
        } catch (err) {
          console.error('[scheduler/run] Twilio auto-send error:', err)
          skipped++
        }
      } else {
        // Queue for manual review
        const { error: queueErr } = await admin.from('send_queue').insert({
          company_id,
          job_id: job.id,
          plan_id: plan.id,
          resolved_message: resolvedMessage,
          status: 'pending',
          queued_at: new Date().toISOString(),
        })
        if (queueErr) {
          console.error('[scheduler/run] queue insert error:', queueErr)
          skipped++
        } else {
          queued++
        }
      }
    }
  }

  return NextResponse.json({ queued, skipped })
}
