import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePlaceholders } from '@/lib/resolvePlaceholders'
import type { Json } from '@/lib/supabase/types'

interface RequestBody {
  job_id?: string
  phone: string
  message: string
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

    // Get company Twilio credentials
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select(
        'name, twilio_account_sid, twilio_auth_token, twilio_phone_number, review_links, albi_email'
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
    const { job_id, phone, message } = body

    if (!phone?.trim()) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 })
    }
    if (!message?.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const toPhone = phone.trim()

    // Check do-not-text
    const { data: dntRow } = await supabase
      .from('do_not_text')
      .select('id')
      .eq('company_id', company_id)
      .eq('phone_number', toPhone)
      .maybeSingle()

    if (dntRow) {
      return NextResponse.json(
        { error: 'This phone number is on the Do Not Text list.' },
        { status: 403 }
      )
    }

    // Resolve placeholders if job_id provided
    let resolvedMessage = message.trim()
    let jobRecord: { id: string; albi_job_id: string; raw_csv_row: Json } | null = null

    if (job_id) {
      const { data: job } = await supabase
        .from('jobs')
        .select('id, albi_job_id, raw_csv_row')
        .eq('id', job_id)
        .eq('company_id', company_id)
        .single()

      if (job) {
        jobRecord = job
        const rawCsvRow =
          job.raw_csv_row &&
          typeof job.raw_csv_row === 'object' &&
          !Array.isArray(job.raw_csv_row)
            ? (job.raw_csv_row as Record<string, string>)
            : {}

        resolvedMessage = resolvePlaceholders(
          message.trim(),
          rawCsvRow,
          reviewLinks,
          job.albi_job_id,
          companyName
        )
      }
    }

    // Send via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`
    const authHeader =
      'Basic ' +
      Buffer.from(`${twilio_account_sid}:${twilio_auth_token}`).toString('base64')

    const params = new URLSearchParams({
      To: toPhone,
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
      console.error('[send-sms/send] Twilio error:', twilioJson)
      return NextResponse.json(
        {
          error:
            twilioJson?.message ??
            `Twilio error: ${twilioRes.status}`,
        },
        { status: 502 }
      )
    }

    const twilio_sid: string | null = twilioJson?.sid ?? null

    // Insert to sent_messages
    await supabase.from('sent_messages').insert({
      company_id,
      job_id: jobRecord?.id ?? null,
      direction: 'outbound',
      body: resolvedMessage,
      to_phone: toPhone,
      from_phone: twilio_phone_number,
      twilio_sid,
    })

    // TODO: Email albi_email notification when manual SMS is sent
    // (company.albi_email is available here when needed)

    return NextResponse.json({ success: true, sid: twilio_sid })
  } catch (err) {
    console.error('[send-sms/send] Unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
