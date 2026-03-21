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
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)
  const sevenDaysAgoStr = toUTCDateString(sevenDaysAgo)

  // ── Bulk pre-fetch everything upfront ──────────────────────────────────────
  const [
    companyRes,
    plansRes,
    jobsRes,
    dntRes,
    sentRes,
    queueRes,
    sentTodayRes,
  ] = await Promise.all([
    admin.from('companies').select('*').eq('id', company_id).single(),
    admin.from('message_plans').select('*').eq('company_id', company_id).eq('is_active', true),
    admin.from('jobs').select('*').eq('company_id', company_id),
    admin.from('do_not_text').select('phone_number').eq('company_id', company_id),
    admin.from('sent_messages').select('job_id, plan_id').eq('company_id', company_id).not('plan_id', 'is', null),
    admin.from('send_queue').select('job_id, plan_id').eq('company_id', company_id),
    admin.from('sent_messages')
      .select('to_phone')
      .eq('company_id', company_id)
      .eq('direction', 'outbound')
      .gte('sent_at', todayStart.toISOString()),
  ])

  const company = companyRes.data
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 400 })

  const reviewLinks = parseReviewLinks(company.review_links)
  const companyName = company.name as string
  const plans = plansRes.data ?? []
  const allJobs = jobsRes.data ?? []

  // Build lookup sets for O(1) checks
  const doNotTextSet = new Set((dntRes.data ?? []).map((r) => r.phone_number))
  const sentSet = new Set((sentRes.data ?? []).map((r) => `${r.job_id}:${r.plan_id}`))
  const queuedSet = new Set((queueRes.data ?? []).map((r) => `${r.job_id}:${r.plan_id}`))
  const sentTodayPhones = new Set((sentTodayRes.data ?? []).map((r) => r.to_phone))

  let queued = 0
  let skipped = 0
  const toQueue: Array<{
    company_id: string
    job_id: string
    plan_id: string
    resolved_message: string
    status: string
    queued_at: string
  }> = []
  const toAutoSend: Array<{
    job: typeof allJobs[number]
    plan: typeof plans[number]
    phone: string
    resolvedMessage: string
  }> = []

  for (const plan of plans) {
    for (const job of allJobs) {
      // Status change plans: only process jobs matching trigger status
      if (plan.trigger_type === 'status_change') {
        if (job.status !== plan.trigger_status_value) { skipped++; continue }
      }

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
        if (triggerStr > today) { skipped++; continue }         // future
        if (triggerStr < sevenDaysAgoStr) { skipped++; continue } // too old
      }

      const phone = job.customer_phone
      if (!phone) { skipped++; continue }
      if (doNotTextSet.has(phone)) { skipped++; continue }

      // In-memory duplicate checks (no extra DB queries)
      const key = `${job.id}:${plan.id}`
      if (sentSet.has(key)) { skipped++; continue }
      if (queuedSet.has(key)) { skipped++; continue }
      if (sentTodayPhones.has(phone)) { skipped++; continue }

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

      if (plan.trigger_type === 'date_offset' && company.auto_send_enabled) {
        toAutoSend.push({ job, plan, phone, resolvedMessage })
      } else {
        toQueue.push({
          company_id,
          job_id: job.id,
          plan_id: plan.id,
          resolved_message: resolvedMessage,
          status: 'pending',
          queued_at: new Date().toISOString(),
        })
        // Mark phone as sent today so subsequent plans skip it
        sentTodayPhones.add(phone)
        queuedSet.add(key)
      }
    }
  }

  // ── Bulk insert queue rows ─────────────────────────────────────────────────
  if (toQueue.length > 0) {
    const { error: queueErr } = await admin.from('send_queue').insert(toQueue)
    if (queueErr) {
      console.error('[scheduler/run] bulk queue insert error:', queueErr)
    } else {
      queued += toQueue.length
    }
  }

  // ── Auto-send (date_offset + auto_send_enabled) ────────────────────────────
  for (const { job, plan, phone, resolvedMessage } of toAutoSend) {
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
  }

  return NextResponse.json({ queued, skipped })
}
