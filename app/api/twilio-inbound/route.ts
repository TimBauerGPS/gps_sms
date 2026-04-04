import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findBestJobForPhone } from '@/lib/inbox/reconcile'

function resolveAppUrl(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }

  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(request.url).origin
}

async function notifyStaff({ company, job, From, Body, appUrl }: {
  company: Record<string, unknown>
  job: Record<string, unknown> | null
  From: string
  Body: string
  appUrl: string
}) {
  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Guardian SMS <noreply@guardiansms.app>'
  if (!resendKey) return

  const recipients: string[] = []
  if (company.albi_email) recipients.push(company.albi_email as string)
  const staffEmails = (company.staff_notification_emails as string[] | null) ?? []
  staffEmails.forEach((e: string) => { if (!recipients.includes(e)) recipients.push(e) })
  if (recipients.length === 0) return

  const customerName  = (job?.customer_name as string | null) ?? From
  const jobName       = (job?.albi_job_id as string | null) ?? null
  const projectUrl    = (job?.albi_project_url as string | null) ?? null

  const jobCell = jobName
    ? projectUrl
      ? `<a href="${projectUrl}" target="_blank">${jobName}</a>`
      : jobName
    : null

  const subject = `New SMS reply${jobName ? ` — ${jobName}` : ''}: ${customerName}`
  const html = `
    <p><strong>New inbound SMS reply</strong></p>
    <table cellpadding="6" cellspacing="0">
      <tr><td><strong>From</strong></td><td>${customerName} (${From})</td></tr>
      ${jobCell ? `<tr><td><strong>Job</strong></td><td>${jobCell}</td></tr>` : ''}
      <tr><td><strong>Message</strong></td><td>${Body}</td></tr>
    </table>
    <p><a href="${appUrl}/inbox">Open Guardian SMS Inbox →</a></p>
    <p><a href="${appUrl}/login">Log in to Guardian SMS →</a></p>
  `

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to: recipients, subject, html }),
    })
  } catch (err) {
    console.error('[twilio-inbound] Failed to send staff notification email:', err)
  }
}

// Returns a valid empty TwiML response so Twilio doesn't retry the webhook
function twimlResponse() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(req: NextRequest) {
  try {
    // Parse form body — Twilio sends application/x-www-form-urlencoded
    const text = await req.text()
    const params = new URLSearchParams(text)
    const From = params.get('From') // customer's phone number
    const To   = params.get('To')   // company's Twilio number
    const Body = params.get('Body') || ''

    if (!From || !To) {
      console.warn('[twilio-inbound] Missing From or To in payload')
      return twimlResponse()
    }

    const admin = createAdminClient()
    const appUrl = resolveAppUrl(req)

    // Look up company by their Twilio phone number
    const { data: company, error: companyErr } = await admin
      .from('companies')
      .select('*')
      .eq('twilio_phone_number', To)
      .single()

    if (companyErr || !company) {
      console.warn('[twilio-inbound] Unknown Twilio number:', To, companyErr?.message)
      return twimlResponse()
    }

    // STOP / UNSUBSCRIBE handling
    const bodyUpper = Body.trim().toUpperCase()
    if (bodyUpper === 'STOP' || bodyUpper === 'UNSUBSCRIBE') {
      const { error: dntErr } = await admin.from('do_not_text').upsert(
        {
          company_id: company.id,
          phone_number: From,
          reason: 'STOP reply',
          added_by: null,
        },
        { onConflict: 'company_id,phone_number' }
      )
      if (dntErr) console.error('[twilio-inbound] do_not_text upsert error:', dntErr)
      else console.log(`[twilio-inbound] Added ${From} to do_not_text for company=${company.id}`)
      return twimlResponse()
    }

    // Find the best matching job for this phone number.
    const job = await findBestJobForPhone(admin, company.id, From)

    // Upsert the conversation record (one row per company+phone)
    const { data: conversation, error: convErr } = await admin
      .from('conversations')
      .upsert(
        {
          company_id: company.id,
          job_id: job?.id ?? null,
          customer_phone: From,
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        },
        { onConflict: 'company_id,customer_phone' }
      )
      .select()
      .single()

    if (convErr) console.error('[twilio-inbound] conversation upsert error:', convErr)

    // Increment unread_count
    if (conversation?.id) {
      const { error: rpcErr } = await admin.rpc('increment_unread', {
        conversation_id: conversation.id,
      })
      if (rpcErr) {
        console.warn('[twilio-inbound] increment_unread RPC failed, falling back:', rpcErr.message)
        await admin
          .from('conversations')
          .update({
            unread_count: (conversation.unread_count ?? 0) + 1,
            last_message_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)
      }
    }

    // Record the inbound message
    const { error: msgErr } = await admin.from('sent_messages').insert({
      company_id: company.id,
      job_id:     job?.id ?? null,
      plan_id:    null,
      direction:  'inbound',
      body:       Body,
      to_phone:   To,
      from_phone: From,
      sent_at:    new Date().toISOString(),
    })
    if (msgErr) console.error('[twilio-inbound] sent_messages insert error:', msgErr)

    console.log(
      `[twilio-inbound] Recorded inbound from ${From} → company=${company.id}` +
      (job ? ` job=${job.id}` : ' (no job match)')
    )

    // Notify staff via email
    await notifyStaff({ company, job, From, Body, appUrl })

    return twimlResponse()

  } catch (err) {
    console.error('[twilio-inbound] Unhandled error:', err)
    return twimlResponse()
  }
}

// Twilio occasionally sends HEAD requests to verify the webhook
export async function GET() {
  return twimlResponse()
}
