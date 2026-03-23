import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import twilio from 'twilio'

export async function POST(request: NextRequest) {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // ── 2. Parse body ────────────────────────────────────────────────────────
    const body = await request.json()
    const { conversation_id, message } = body as {
      conversation_id: string
      message: string
    }

    if (!conversation_id || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: 'conversation_id and message are required' },
        { status: 400 }
      )
    }

    // Use admin client for writes to bypass RLS where needed
    const admin = createAdminClient()

    // ── 3. Get company + Twilio creds ────────────────────────────────────────
    const { data: userRow, error: userError } = await admin
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (userError || !userRow) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 })
    }

    const companyId = userRow.company_id

    const { data: company, error: companyError } = await admin
      .from('companies')
      .select(
        'id, name, twilio_account_sid, twilio_auth_token, twilio_phone_number, albi_email'
      )
      .eq('id', companyId)
      .single()

    if (companyError || !company) {
      return NextResponse.json({ success: false, error: 'Company not found' }, { status: 403 })
    }

    if (
      !company.twilio_account_sid ||
      !company.twilio_auth_token ||
      !company.twilio_phone_number
    ) {
      return NextResponse.json(
        { success: false, error: 'Twilio credentials not configured' },
        { status: 422 }
      )
    }

    // ── 4. Fetch conversation ────────────────────────────────────────────────
    const { data: conversation, error: convError } = await admin
      .from('conversations')
      .select('id, company_id, job_id, customer_phone')
      .eq('id', conversation_id)
      .eq('company_id', companyId)
      .single()

    if (convError || !conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const customerPhone = conversation.customer_phone

    // ── 5. Check do_not_text ─────────────────────────────────────────────────
    const { data: dntRow } = await admin
      .from('do_not_text')
      .select('id')
      .eq('company_id', companyId)
      .eq('phone_number', customerPhone)
      .maybeSingle()

    if (dntRow) {
      return NextResponse.json(
        { success: false, error: 'This number is on the Do Not Text list' },
        { status: 422 }
      )
    }

    // ── 6. Send via Twilio ───────────────────────────────────────────────────
    const twilioClient = twilio(
      company.twilio_account_sid,
      company.twilio_auth_token
    )

    const twilioMessage = await twilioClient.messages.create({
      body: message.trim(),
      from: company.twilio_phone_number,
      to: customerPhone,
    })

    const sentAt = new Date().toISOString()

    // ── 7. Insert to sent_messages ───────────────────────────────────────────
    const { error: insertError } = await admin.from('sent_messages').insert({
      company_id: companyId,
      job_id: conversation.job_id ?? null,
      plan_id: null,
      direction: 'outbound',
      body: message.trim(),
      to_phone: customerPhone,
      from_phone: company.twilio_phone_number,
      twilio_sid: twilioMessage.sid,
      sent_at: sentAt,
    })

    if (insertError) {
      console.error('[inbox/send] Failed to log sent_message:', insertError)
      // Don't fail the request — message was sent successfully
    }

    // ── 8. Update conversations.last_message_at ──────────────────────────────
    await admin
      .from('conversations')
      .update({ last_message_at: sentAt })
      .eq('id', conversation_id)

    // ── 9. Email copy to albi_email ──────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Guardian SMS <noreply@guardiansms.app>'
    if (company.albi_email && resendKey) {
      let jobLabel = customerPhone
      if (conversation.job_id) {
        const { data: jobRow } = await admin
          .from('jobs')
          .select('albi_job_id')
          .eq('id', conversation.job_id)
          .single()
        if (jobRow?.albi_job_id) jobLabel = jobRow.albi_job_id
      }
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
            html: `<p><strong>Outbound SMS sent to ${jobLabel}</strong></p><p>${message.trim()}</p>`,
          }),
        })
      } catch (err) {
        console.error('[inbox/send] Failed to send albi email:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[inbox/send] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
