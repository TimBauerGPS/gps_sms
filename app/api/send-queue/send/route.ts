import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRepliedMessageSet, hasRepliedToMessage } from '@/lib/replyDedup'
import { LOST_STATUS_SKIP_REASON, shouldBlockForLostStatus } from '@/lib/messages/lostStatusGuard.js'

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
      .select('*, job:jobs ( customer_phone, id, albi_job_id, status ), plan:message_plans ( trigger_status_value )')
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

    const { data: messageHistoryRows } = await admin
      .from('sent_messages')
      .select('direction, body, to_phone, from_phone, sent_at')
      .eq('company_id', companyId)
    const repliedMessages = buildRepliedMessageSet(messageHistoryRows ?? [])

    const queuedPhones = Array.from(
      new Set(
        queueRows
          .map((queueRow) => {
            const job = Array.isArray(queueRow.job) ? queueRow.job[0] : queueRow.job
            return job?.customer_phone
          })
          .filter(Boolean)
      )
    )

    const { data: relatedJobRows } = queuedPhones.length
      ? await admin
          .from('jobs')
          .select('customer_phone, status')
          .eq('company_id', companyId)
          .in('customer_phone', queuedPhones)
      : { data: [] }

    const relatedJobsByPhone = new Map<string, { status: string | null }[]>()
    for (const relatedJob of relatedJobRows ?? []) {
      if (!relatedJob.customer_phone) continue
      const existing = relatedJobsByPhone.get(relatedJob.customer_phone)
      if (existing) {
        existing.push({ status: relatedJob.status })
      } else {
        relatedJobsByPhone.set(relatedJob.customer_phone, [{ status: relatedJob.status }])
      }
    }

    for (const queueRow of queueRows) {
      const jobRow = (Array.isArray(queueRow.job) ? queueRow.job[0] : queueRow.job) as {
        customer_phone: string | null
        id: string
        albi_job_id: string
        status: string | null
      } | null
      const planRow = (Array.isArray(queueRow.plan) ? queueRow.plan[0] : queueRow.plan) as {
        trigger_status_value: string | null
      } | null
      const toPhone = jobRow?.customer_phone

      if (!toPhone) {
        errors.push(`Row ${queueRow.id}: no customer phone`)
        continue
      }

      const lostStatusCheck = shouldBlockForLostStatus({
        relatedJobs: relatedJobsByPhone.get(toPhone) ?? [],
        sendContext: {
          jobStatus: jobRow.status,
          planTriggerStatusValue: planRow?.trigger_status_value,
        },
      })

      if (lostStatusCheck.blocked) {
        errors.push(`Row ${queueRow.id}: phone ${toPhone} has a Lost job status — skipped`)
        await admin
          .from('send_queue')
          .update({
            status: 'skipped',
            skipped_reason: LOST_STATUS_SKIP_REASON,
            processed_at: new Date().toISOString(),
          })
          .eq('id', queueRow.id)
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

      if (hasRepliedToMessage(repliedMessages, toPhone, queueRow.resolved_message)) {
        errors.push(`Row ${queueRow.id}: ${toPhone} already replied to this message in the past`)
        await admin
          .from('send_queue')
          .update({
            status: 'skipped',
            skipped_reason: 'replied_to_same_message',
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
      } catch {
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

      // ── Email copy to albi_email ───────────────────────────────────────────
      const resendKey = process.env.RESEND_API_KEY
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'Guardian SMS <noreply@guardiansms.app>'
      if (company.albi_email && resendKey) {
        const jobLabel = jobRow?.albi_job_id ?? queueRow.job_id
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromEmail,
              to: company.albi_email,
              subject: `[${jobLabel}] SMS Message`,
              html: `<p><strong>Outbound SMS sent to ${jobLabel}</strong></p><p>${queueRow.resolved_message}</p>`,
            }),
          })
        } catch (err) {
          console.error('[send-queue/send] Failed to send albi email:', err)
        }
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
