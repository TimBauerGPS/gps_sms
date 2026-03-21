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

  // ── Pass 1: bulk fetch everything except raw_csv_row ──────────────────────
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
    // Exclude raw_csv_row — fetched only for candidates in pass 2
    admin.from('jobs')
      .select('id,company_id,albi_job_id,customer_name,customer_phone,status,created_at_albi,inspection_date,estimated_work_start_date,file_closed,estimate_sent,contract_signed,coc_cos_signed,invoiced,work_start,paid,estimated_completion_date')
      .eq('company_id', company_id),
    admin.from('do_not_text').select('phone_number').eq('company_id', company_id),
    admin.from('sent_messages').select('job_id,plan_id').eq('company_id', company_id).not('plan_id', 'is', null),
    admin.from('send_queue').select('job_id,plan_id').eq('company_id', company_id),
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

  const doNotTextSet = new Set((dntRes.data ?? []).map((r) => r.phone_number))
  const sentSet = new Set((sentRes.data ?? []).map((r) => `${r.job_id}:${r.plan_id}`))
  const queuedSet = new Set((queueRes.data ?? []).map((r) => `${r.job_id}:${r.plan_id}`))
  const sentTodayPhones = new Set((sentTodayRes.data ?? []).map((r) => r.to_phone))

  // ── Filtering pass (no DB queries) ────────────────────────────────────────
  type Candidate = { jobId: string; plan: typeof plans[number]; phone: string; autoSend: boolean }
  const candidates: Candidate[] = []

  for (const plan of plans) {
    for (const job of allJobs) {
      if (plan.trigger_type === 'status_change') {
        if (job.status !== plan.trigger_status_value) continue
      }

      if (isBeforeCutoff(job as Record<string, unknown>)) continue
      if (!jobMatchesTypeFilter(job as Record<string, unknown>, plan.trigger_job_type_strings)) continue

      if (plan.trigger_type === 'date_offset') {
        const field = plan.trigger_date_field as string
        const rawDate = (job as Record<string, unknown>)[field] as string | null
        if (!rawDate) continue
        const triggerDate = new Date(rawDate)
        triggerDate.setUTCDate(triggerDate.getUTCDate() + (plan.trigger_offset_days ?? 0))
        const triggerStr = toUTCDateString(triggerDate)
        if (triggerStr > today) continue
        if (triggerStr < sevenDaysAgoStr) continue
      }

      const phone = job.customer_phone
      if (!phone) continue
      if (doNotTextSet.has(phone)) continue

      const key = `${job.id}:${plan.id}`
      if (sentSet.has(key)) continue
      if (queuedSet.has(key)) continue
      if (sentTodayPhones.has(phone)) continue

      const autoSend = plan.trigger_type === 'date_offset' && !!company.auto_send_enabled
      candidates.push({ jobId: job.id, plan, phone, autoSend })
      sentTodayPhones.add(phone)
      queuedSet.add(key)
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ queued: 0, skipped: 0 })
  }

  // ── Pass 2: fetch raw_csv_row only for candidate jobs ─────────────────────
  const candidateJobIds = [...new Set(candidates.map((c) => c.jobId))]
  const { data: csvRows } = await admin
    .from('jobs')
    .select('id,raw_csv_row')
    .in('id', candidateJobIds)

  const csvRowMap = new Map<string, Record<string, string>>(
    (csvRows ?? []).map((r) => {
      const row =
        r.raw_csv_row && typeof r.raw_csv_row === 'object' && !Array.isArray(r.raw_csv_row)
          ? (r.raw_csv_row as Record<string, string>)
          : {}
      return [r.id, row]
    })
  )

  // ── Build queue rows and auto-send list ────────────────────────────────────
  const toQueue: Array<{
    company_id: string
    job_id: string
    plan_id: string
    resolved_message: string
    status: 'pending' | 'sent' | 'skipped'
    queued_at: string
  }> = []
  const toAutoSend: Array<{ phone: string; resolvedMessage: string; jobId: string; planId: string }> = []

  for (const { jobId, plan, phone, autoSend } of candidates) {
    const rawCsvRow = csvRowMap.get(jobId) ?? {}
    const jobRow = allJobs.find((j) => j.id === jobId)
    const resolvedMessage = resolvePlaceholders(
      plan.message_template,
      rawCsvRow,
      reviewLinks,
      jobRow?.albi_job_id ?? '',
      companyName
    )

    if (autoSend) {
      toAutoSend.push({ phone, resolvedMessage, jobId, planId: plan.id })
    } else {
      toQueue.push({
        company_id,
        job_id: jobId,
        plan_id: plan.id,
        resolved_message: resolvedMessage,
        status: 'pending',
        queued_at: new Date().toISOString(),
      })
    }
  }

  let queued = 0
  let skipped = 0

  // ── Bulk insert queue rows ─────────────────────────────────────────────────
  if (toQueue.length > 0) {
    const { error } = await admin.from('send_queue').insert(toQueue)
    if (error) {
      console.error('[scheduler/run] queue insert error:', error)
      skipped += toQueue.length
    } else {
      queued += toQueue.length
    }
  }

  // ── Auto-send ──────────────────────────────────────────────────────────────
  for (const { phone, resolvedMessage, jobId, planId } of toAutoSend) {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${company.twilio_account_sid}/Messages.json`
    const authHeader =
      'Basic ' +
      Buffer.from(`${company.twilio_account_sid}:${company.twilio_auth_token}`).toString('base64')
    try {
      const twilioRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: phone, From: company.twilio_phone_number ?? '', Body: resolvedMessage }),
      })
      if (!twilioRes.ok) throw new Error(`Twilio ${twilioRes.status}`)
      await admin.from('sent_messages').insert({
        company_id,
        job_id: jobId,
        plan_id: planId,
        to_phone: phone,
        from_phone: company.twilio_phone_number ?? '',
        body: resolvedMessage,
        direction: 'outbound',
        sent_at: new Date().toISOString(),
      })
      queued++
    } catch (err) {
      console.error('[scheduler/run] auto-send error:', err)
      skipped++
    }
  }

  return NextResponse.json({ queued, skipped })
}
