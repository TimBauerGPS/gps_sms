// Netlify function — handles inbound Twilio webhook (POST from Twilio)
// Twilio must be configured to POST to:
//   https://<your-site>/.netlify/functions/twilio-inbound
//
// Security note: production deployments should validate the X-Twilio-Signature
// header. See https://www.twilio.com/docs/usage/webhooks/webhooks-security

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  try {
    // 1. Only accept POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' }
    }

    // 2. Parse form body — Twilio sends application/x-www-form-urlencoded
    const params = new URLSearchParams(event.body ?? '')
    const From = params.get('From') // customer's phone number
    const To   = params.get('To')   // company's Twilio number
    const Body = params.get('Body') || ''

    if (!From || !To) {
      console.warn('[twilio-inbound] Missing From or To in payload')
      return twimlResponse()
    }

    // 3. Supabase admin client (service role bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // 4. Look up company by their Twilio phone number
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('*')
      .eq('twilio_phone_number', To)
      .single()

    if (companyErr || !company) {
      console.warn('[twilio-inbound] Unknown Twilio number:', To, companyErr?.message)
      return twimlResponse() // Unknown number — ignore silently
    }

    // 5. STOP / UNSUBSCRIBE handling
    const bodyUpper = Body.trim().toUpperCase()
    if (bodyUpper === 'STOP' || bodyUpper === 'UNSUBSCRIBE') {
      const { error: dntErr } = await supabase.from('do_not_text').upsert(
        {
          company_id: company.id,
          phone_number: From,
          reason: 'STOP reply',
          added_by: null,
        },
        { onConflict: 'company_id,phone_number' }
      )
      if (dntErr) {
        console.error('[twilio-inbound] do_not_text upsert error:', dntErr)
      } else {
        console.log(`[twilio-inbound] Added ${From} to do_not_text for company=${company.id}`)
      }
      return twimlResponse()
    }

    // 6. Find a matching job for this customer phone number (best-effort)
    const { data: job } = await supabase
      .from('jobs')
      .select('*')
      .eq('company_id', company.id)
      .eq('customer_phone', From)
      .maybeSingle()
    // job may be null — that's fine, inbound messages don't require a matched job

    // 7. Upsert the conversation record (one row per company+phone)
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .upsert(
        {
          company_id: company.id,
          job_id: job?.id ?? null,
          customer_phone: From,
          last_message_at: new Date().toISOString(),
          unread_count: 1, // will be incremented below via RPC
        },
        { onConflict: 'company_id,customer_phone' }
      )
      .select()
      .single()

    if (convErr) {
      console.error('[twilio-inbound] conversation upsert error:', convErr)
    }

    // Increment unread_count on the existing row.
    if (conversation?.id) {
      const { error: rpcErr } = await supabase.rpc('increment_unread', {
        conversation_id: conversation.id,
      })
      if (rpcErr) {
        console.warn('[twilio-inbound] increment_unread RPC failed, falling back:', rpcErr.message)
        await supabase
          .from('conversations')
          .update({
            unread_count: (conversation.unread_count ?? 0) + 1,
            last_message_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)
      }
    }

    // 8. Record the inbound message in sent_messages
    const { error: msgErr } = await supabase.from('sent_messages').insert({
      company_id: company.id,
      job_id:     job?.id ?? null,
      plan_id:    null,
      direction:  'inbound',
      body:       Body,
      to_phone:   To,
      from_phone: From,
      sent_at:    new Date().toISOString(),
    })
    if (msgErr) {
      console.error('[twilio-inbound] sent_messages insert error:', msgErr)
    }

    console.log(
      `[twilio-inbound] Recorded inbound from ${From} → company=${company.id}` +
      (job ? ` job=${job.id}` : ' (no job match)')
    )

    return twimlResponse()

  } catch (err) {
    // Always return valid TwiML so Twilio doesn't retry endlessly
    console.error('[twilio-inbound] Unhandled error:', err)
    return twimlResponse()
  }
}

// Returns an empty TwiML response so Twilio doesn't retry the webhook
function twimlResponse() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  }
}
