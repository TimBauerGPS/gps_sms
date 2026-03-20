import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: userRow } = await admin.from('users').select('company_id').eq('id', user.id).single()
  if (!userRow) return NextResponse.json({ error: 'No company' }, { status: 400 })

  const { data: company } = await admin
    .from('companies')
    .select('twilio_account_sid, twilio_auth_token, twilio_phone_number')
    .eq('id', userRow.company_id)
    .single()

  if (!company?.twilio_account_sid || !company?.twilio_auth_token || !company?.twilio_phone_number) {
    return NextResponse.json({ error: 'Twilio credentials not saved yet' }, { status: 400 })
  }

  const { twilio_account_sid: sid, twilio_auth_token: token, twilio_phone_number: phone } = company
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`

  const result = {
    credentials: { ok: false, message: '' },
    phoneNumber: { ok: false, message: '' },
    webhook: { ok: false, message: '', current: '', expected: '' },
  }

  // 1. Verify credentials
  try {
    const res = await fetch(`${base}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    if (res.ok) {
      result.credentials = { ok: true, message: 'Credentials are valid' }
    } else {
      const body = await res.json().catch(() => ({}))
      result.credentials = { ok: false, message: body.message ?? `HTTP ${res.status}` }
      return NextResponse.json(result)
    }
  } catch {
    result.credentials = { ok: false, message: 'Network error reaching Twilio' }
    return NextResponse.json(result)
  }

  // 2. Find phone number on account
  let phoneSid: string | null = null
  try {
    const encoded = encodeURIComponent(phone)
    const res = await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encoded}`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    const body = await res.json()
    if (body.incoming_phone_numbers?.length > 0) {
      const num = body.incoming_phone_numbers[0]
      phoneSid = num.sid
      result.phoneNumber = { ok: true, message: `Found: ${num.friendly_name ?? phone}` }
    } else {
      result.phoneNumber = { ok: false, message: `${phone} not found on this account` }
      return NextResponse.json(result)
    }
  } catch {
    result.phoneNumber = { ok: false, message: 'Could not look up phone number' }
    return NextResponse.json(result)
  }

  // 3. Check webhook URL
  const expectedWebhook = `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio-inbound`
  result.webhook.expected = expectedWebhook

  try {
    const res = await fetch(`${base}/IncomingPhoneNumbers/${phoneSid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    const num = await res.json()
    const current = num.sms_url ?? ''
    result.webhook.current = current || '(not set)'

    if (current === expectedWebhook) {
      result.webhook = { ok: true, message: 'Webhook is correctly configured', current, expected: expectedWebhook }
    } else if (!current) {
      result.webhook = { ok: false, message: 'No webhook URL set on this number', current: '(not set)', expected: expectedWebhook }
    } else {
      result.webhook = { ok: false, message: 'Webhook URL does not match', current, expected: expectedWebhook }
    }
  } catch {
    result.webhook = { ok: false, message: 'Could not fetch phone number config', current: '', expected: expectedWebhook }
  }

  return NextResponse.json(result)
}
