import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authSupabase = await createClient()
    const {
      data: { user },
    } = await authSupabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    const { data: userRow } = await admin
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (!userRow) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 })
    }

    const companyId = userRow.company_id

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json()
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : []

    if (!ids.length) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
    }

    // ── Fetch company Twilio credentials ────────────────────────────────────
    const { data: company } = await admin
      .from('companies')
      .select(
        'twilio_account_sid, twilio_auth_token, twilio_phone_number, albi_email'
      )
      .eq('id', companyId)
      .single()

    if (
      !company?.twilio_account_sid ||
      !company?.twilio_auth_token ||
      !company?.twilio_phone_number
    ) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured for this company.' },
        { status: 422 }
      )
    }

    const sid = company.twilio_account_sid
    const token = company.twilio_auth_token
    const fromPhone = company.twilio_phone_number

    // ── Fetch send_queue rows (verify company ownership) ────────────────────
    const { data: queueRows } = await admin
      .from('send_queue')
      .select('*, job:jobs ( customer_phone, id, albi_job_id )')
      .in('id', ids)
      .eq('company_id', companyId)
      .eq('status', 'pending')

    if (!queueRows?.length) {
      return NextResponse.json(
        { error: 'No valid pending rows found for this company.' },
        { status: 404 }
      )
    }

    // ── Process each row ────────────────────────────────────────────────────
    let sent = 0
    const errors: string[] = []

    // Track phones we've already sent to in this batch (same-day dedup within batch)
    const sentThisBatch = new Set<string>()

    // Pre-load today's already-sent phones from sent_messages
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const { data: sentTodayRows } = await admin
      .from('sent_messages')
      .select('to_phone')
      .eq('company_id', companyId)
      .eq('direction', 'outbound')
      .gte('sent_at', todayStart.toISOString())
    const sentTodayPhones = new Set((sentTodayRows ?? []).map((r) => r.to_phone))

    for (const queueRow of queueRows) {
      const jobRow = queueRow.job as { customer_phone: string | null; id: string; albi_job_id: string } | null
      const toPhone = jobRow?.customer_phone

      if (!toPhone) {
        errors.push(`Row ${queueRow.id}: no customer phone`)
        continue
      }

      // Skip if already sent to this phone today (either before this batch or earlier in it)
      if (sentTodayPhones.has(toPhone) || sentThisBatch.has(toPhone)) {
        errors.push(`Row ${queueRow.id}: already sent to ${toPhone} today — skipped`)
        await admin
          .from('send_queue')
          .update({ status: 'skipped', skipped_reason: 'already_sent_today', processed_at: new Date().toISOString() })
          .eq('id', queueRow.id)
        continue
      }

      // Check do_not_text
      const { data: dnt } = await admin
        .from('do_not_text')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone_number', toPhone)
        .maybeSingle()

      if (dnt) {
        errors.push(`Row ${queueRow.id}: phone ${toPhone} is on do-not-text list`)
        await admin
          .from('send_queue')
          .update({
            status: 'skipped',
            skipped_reason: 'do_not_text',
            processed_at: new Date().toISOString(),
          })
          .eq('id', queueRow.id)
        continue
      }

      // Send via Twilio REST API
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
      const twilioBody = new URLSearchParams({
        To: toPhone,
        From: fromPhone,
        Body: queueRow.resolved_message,
      })

      let twilioSid: string | null = null
      try {
        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            Authorization:
              'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: twilioBody,
        })

        const twilioJson = await twilioRes.json()

        if (!twilioRes.ok) {
          errors.push(
            `Row ${queueRow.id}: Twilio error ${twilioRes.status} — ${twilioJson?.message ?? 'Unknown error'}`
          )
          continue
        }

        twilioSid = twilioJson.sid ?? null
      } catch (fetchErr) {
        errors.push(`Row ${queueRow.id}: network error sending to Twilio`)
        continue
      }

      // Insert to sent_messages
      await admin.from('sent_messages').insert({
        company_id: companyId,
        job_id: jobRow?.id ?? null,
        plan_id: queueRow.plan_id,
        direction: 'outbound',
        body: queueRow.resolved_message,
        to_phone: toPhone,
        from_phone: fromPhone,
        twilio_sid: twilioSid,
        sent_at: new Date().toISOString(),
      })

      // TODO: Send email notification to albi_email when a message is sent.
      // Integrate a transactional email provider (e.g. Resend, SendGrid, Postmark)
      // and send a notification to company.albi_email here.
      if (company.albi_email) {
        console.log(
          `[send-queue/send] TODO: email notification to ${company.albi_email} for job ${jobRow?.albi_job_id ?? queueRow.job_id}`
        )
      }

      // Mark as sent
      await admin
        .from('send_queue')
        .update({
          status: 'sent',
          processed_at: new Date().toISOString(),
        })
        .eq('id', queueRow.id)

      sentThisBatch.add(toPhone)
      sent++
    }

    return NextResponse.json({ sent, errors })
  } catch (err) {
    console.error('[send-queue/send] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
