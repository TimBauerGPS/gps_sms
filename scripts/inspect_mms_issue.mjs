import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = trimmed.slice(0, equalsIndex).trim()
    const value = trimmed.slice(equalsIndex + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile('.env.local')

const companyId = process.argv[2] || 'e0ada35f-e20f-41d1-b067-ab06fb27ebcd'
const customerPhone = process.argv[3] || '+17143312255'
const companyPhone = process.argv[4] || '+17325875238'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: messages, error: messagesError } = await supabase
  .from('sent_messages')
  .select('id, body, twilio_sid, sent_at, direction, to_phone, from_phone')
  .eq('company_id', companyId)
  .or(`to_phone.eq.${customerPhone},from_phone.eq.${customerPhone}`)
  .order('sent_at', { ascending: true })

if (messagesError) throw messagesError

console.log('Inbound messages in app:')
for (const message of messages.filter((row) => row.direction === 'inbound')) {
  console.log({
    id: message.id,
    sid: message.twilio_sid,
    sent_at: message.sent_at,
    body: message.body,
  })

  if (!message.twilio_sid) continue

  const prefix = `${companyId}/${message.twilio_sid}`
  const { data: files, error: filesError } = await supabase.storage
    .from('message-media')
    .list(prefix, {
      limit: 20,
      sortBy: { column: 'name', order: 'asc' },
    })

  console.log('  stored files:', filesError?.message ?? files ?? [])
}

const { data: company, error: companyError } = await supabase
  .from('companies')
  .select('twilio_account_sid, twilio_auth_token')
  .eq('id', companyId)
  .single()

if (companyError) throw companyError

const twilioClient = twilio(
  company.twilio_account_sid,
  company.twilio_auth_token
)

const twilioMessages = await twilioClient.messages.list({
  to: companyPhone,
  from: customerPhone,
  limit: 20,
})

console.log('\nRecent inbound messages in Twilio:')
for (const message of twilioMessages) {
  console.log({
    sid: message.sid,
    body: message.body,
    numMedia: message.numMedia,
    dateCreated: message.dateCreated?.toISOString?.() ?? message.dateCreated,
    direction: message.direction,
  })

  const media = await twilioClient.messages(message.sid).media.list({ limit: 10 })
  if (media.length > 0) {
    console.log(
      '  media:',
      media.map((item) => ({
        sid: item.sid,
        contentType: item.contentType,
        uri: item.uri,
      }))
    )
  }
}
