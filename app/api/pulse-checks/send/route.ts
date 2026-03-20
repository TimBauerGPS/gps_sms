import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePlaceholders } from '@/lib/resolvePlaceholders'
import type { Json } from '@/lib/supabase/types'

interface RequestBody {
  job_ids: string[]
  message_template: string
  target_statuses: string[]
  target_job_type_strings: string[]
}

interface ReviewLink {
  match_string: string
  url: string
}

function parseReviewLinks(raw: Json): ReviewLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      'url' in item
    ) {
      return [
        {
          match_string: String((item as Record<string, unknown>).match_string ?? ''),
          url: String((item as Record<string, unknown>).url ?? ''),
        },
      ]
    }
    return []
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get company_id
    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (userErr || !userRow) {
      return NextResponse.json({ error: 'User record not found' }, { status: 401 })
    }

    const company_id = userRow.company_id

    // Get company Twilio credentials and review_links
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select(
        'name, twilio_account_sid, twilio_auth_token, twilio_phone_number, review_links'
      )
      .eq('id', company_id)
      .single()

    if (companyErr || !company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 400 })
    }

    const {
      name: companyName,
      twilio_account_sid,
      twilio_auth_token,
      twilio_phone_number,
      review_links,
    } = company

    if (!twilio_account_sid || !twilio_auth_token || !twilio_phone_number) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured for this company' },
        { status: 400 }
      )
    }

    const reviewLinks = parseReviewLinks(review_links)

    // Parse body
    const body: RequestBody = await req.json()
    const { job_ids, message_template, target_statuses, target_job_type_strings } =
      body

    if (!job_ids?.length) {
      return NextResponse.json({ error: 'No job_ids provided' }, { status: 400 })
    }
    if (!message_template?.trim()) {
      return NextResponse.json(
        { error: 'message_template is required' },
        { status: 400 }
      )
    }

    // Fetch do-not-text list
    const { data: dntRows } = await supabase
      .from('do_not_text')
      .select('phone_number')
      .eq('company_id', company_id)

    const doNotTextSet = new Set(
      (dntRows ?? []).map((r) => r.phone_number)
    )

    let sent = 0
    let skipped = 0
    const sentJobIds: string[] = []

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`
    const authHeader =
      'Basic ' +
      Buffer.from(`${twilio_account_sid}:${twilio_auth_token}`).toString(
        'base64'
      )

    for (const job_id of job_ids) {
      // Fetch the job record
      const { data: job, error: jobErr } = await supabase
        .from('jobs')
        .select(
          'id, albi_job_id, customer_phone, raw_csv_row, company_id'
        )
        .eq('id', job_id)
        .eq('company_id', company_id)
        .single()

      if (jobErr || !job) {
        skipped++
        continue
      }

      const phone = job.customer_phone
      if (!phone) {
        skipped++
        continue
      }

      // Check do-not-text
      if (doNotTextSet.has(phone)) {
        skipped++
        continue
      }

      // Resolve placeholders
      const rawCsvRow =
        job.raw_csv_row && typeof job.raw_csv_row === 'object' && !Array.isArray(job.raw_csv_row)
          ? (job.raw_csv_row as Record<string, string>)
          : {}

      const resolvedMessage = resolvePlaceholders(
        message_template,
        rawCsvRow,
        reviewLinks,
        job.albi_job_id,
        companyName
      )

      // Send via Twilio
      const params = new URLSearchParams({
        To: phone,
        From: twilio_phone_number,
        Body: resolvedMessage,
      })

      const twilioRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      const twilioJson = await twilioRes.json()

      if (!twilioRes.ok) {
        console.error(
          `[pulse-checks/send] Twilio error for job ${job_id}:`,
          twilioJson
        )
        skipped++
        continue
      }

      const twilio_sid: string | null = twilioJson?.sid ?? null

      // Insert to sent_messages
      await supabase.from('sent_messages').insert({
        company_id,
        job_id,
        direction: 'outbound',
        body: resolvedMessage,
        to_phone: phone,
        from_phone: twilio_phone_number,
        twilio_sid,
      })

      sentJobIds.push(job_id)
      sent++
    }

    // Insert pulse_check_run record
    await supabase.from('pulse_check_runs').insert({
      company_id,
      message_template,
      target_statuses: target_statuses ?? [],
      target_job_type_strings: target_job_type_strings ?? [],
      job_ids_sent: sentJobIds,
    })

    return NextResponse.json({ sent, skipped })
  } catch (err) {
    console.error('[pulse-checks/send] Unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
