import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const MESSAGE_MEDIA_BUCKET = 'message-media'

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
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function extensionForMimeType(mimeType) {
  switch ((mimeType ?? '').split(';')[0].trim().toLowerCase()) {
    case 'text/x-vcard':
    case 'text/vcard':
      return 'vcf'
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'video/mp4':
      return 'mp4'
    case 'video/quicktime':
      return 'mov'
    case 'application/pdf':
      return 'pdf'
    default: {
      const suffix = (mimeType ?? '').split('/')[1]
      return suffix ? suffix.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'bin'
    }
  }
}

function pickLatestTimestamp(currentValue, incomingValue) {
  const currentTime = new Date(currentValue).getTime()
  const incomingTime = new Date(incomingValue).getTime()

  if (Number.isNaN(currentTime)) return incomingValue
  if (Number.isNaN(incomingTime)) return currentValue
  return incomingTime > currentTime ? incomingValue : currentValue
}

async function findLegacyInboundMessageCandidate({
  supabase,
  body,
  companyId,
  from,
  receivedAt,
  to,
}) {
  const receivedTime = new Date(receivedAt).getTime()
  const tenMinutesMs = 10 * 60 * 1000
  const windowStart = new Date(receivedTime - tenMinutesMs).toISOString()
  const windowEnd = new Date(receivedTime + tenMinutesMs).toISOString()

  const { data, error } = await supabase
    .from('sent_messages')
    .select('id, job_id, sent_at')
    .eq('company_id', companyId)
    .eq('direction', 'inbound')
    .eq('from_phone', from)
    .eq('to_phone', to)
    .eq('body', body)
    .is('twilio_sid', null)
    .gte('sent_at', windowStart)
    .lte('sent_at', windowEnd)
    .order('sent_at', { ascending: true })
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

async function ensureBucket(supabase) {
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(
    MESSAGE_MEDIA_BUCKET
  )

  if (bucket) return

  const shouldCreate =
    !bucketError || /not found|does not exist/i.test(bucketError.message)

  if (!shouldCreate) {
    throw bucketError
  }

  const { error: createError } = await supabase.storage.createBucket(
    MESSAGE_MEDIA_BUCKET,
    { public: false }
  )

  if (
    createError &&
    !/already exists|duplicate/i.test(createError.message)
  ) {
    throw createError
  }
}

async function pickCompany(supabase, selector) {
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name, twilio_account_sid, twilio_auth_token, twilio_phone_number')
    .not('twilio_account_sid', 'is', null)
    .not('twilio_auth_token', 'is', null)
    .not('twilio_phone_number', 'is', null)

  if (error) throw error

  const usableCompanies = (companies ?? []).filter(
    (company) =>
      company.twilio_account_sid &&
      company.twilio_auth_token &&
      company.twilio_phone_number
  )

  if (usableCompanies.length === 0) {
    throw new Error('No companies with Twilio credentials were found.')
  }

  if (selector) {
    const selected = usableCompanies.find(
      (company) =>
        company.id === selector ||
        company.name.toLowerCase() === selector.toLowerCase() ||
        company.twilio_phone_number === selector
    )

    if (!selected) {
      throw new Error(`Could not find a company matching "${selector}".`)
    }

    return selected
  }

  if (usableCompanies.length === 1) {
    return usableCompanies[0]
  }

  throw new Error(
    `Multiple companies found. Re-run with --company <id|name|phone>.\n${usableCompanies
      .map((company) => `- ${company.id} | ${company.name} | ${company.twilio_phone_number}`)
      .join('\n')}`
  )
}

async function findBestJobForPhone(supabase, companyId, phone) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('company_id', companyId)
    .eq('customer_phone', phone)
    .order('updated_at', { ascending: false })
    .order('imported_at', { ascending: false })
    .order('created_at_albi', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

async function syncConversationForInbound({
  supabase,
  companyId,
  customerPhone,
  jobId,
  receivedAt,
  shouldIncrementUnread,
}) {
  const { data: conversation, error: fetchError } = await supabase
    .from('conversations')
    .select('id, job_id, last_message_at, unread_count')
    .eq('company_id', companyId)
    .eq('customer_phone', customerPhone)
    .maybeSingle()

  if (fetchError) throw fetchError

  if (!conversation) {
    const { error: insertError } = await supabase.from('conversations').insert({
      company_id: companyId,
      customer_phone: customerPhone,
      job_id: jobId,
      last_message_at: receivedAt,
      unread_count: shouldIncrementUnread ? 1 : 0,
    })
    if (insertError) throw insertError
    return
  }

  const { error: updateError } = await supabase
    .from('conversations')
    .update({
      job_id: conversation.job_id ?? jobId,
      last_message_at: pickLatestTimestamp(
        conversation.last_message_at,
        receivedAt
      ),
      unread_count: shouldIncrementUnread
        ? conversation.unread_count + 1
        : conversation.unread_count,
    })
    .eq('id', conversation.id)

  if (updateError) throw updateError
}

async function storeMedia({
  supabase,
  authHeader,
  companyId,
  mediaItems,
  messageId,
  messageSid,
}) {
  if (mediaItems.length === 0) return 0

  await ensureBucket(supabase)

  const prefix = `${companyId}/${messageSid ?? messageId}`
  const { data: existingFiles, error: listError } = await supabase.storage
    .from(MESSAGE_MEDIA_BUCKET)
    .list(prefix, {
      limit: 10,
      sortBy: { column: 'name', order: 'asc' },
    })

  if (listError && !/not found|does not exist/i.test(listError.message)) {
    throw listError
  }

  const existingNames = new Set((existingFiles ?? []).map((file) => file.name))
  let insertedCount = 0

  for (const mediaItem of mediaItems) {
    const mediaUrl = `https://api.twilio.com${mediaItem.uri.replace(/\.json$/, '')}`
    const mimeType = mediaItem.contentType || 'application/octet-stream'
    const fileStem = mediaItem.sid || `media-${insertedCount + 1}`
    const extension = extensionForMimeType(mimeType)
    const filename = `${fileStem}.${extension}`

    if (existingNames.has(filename)) {
      continue
    }

    const mediaResponse = await fetch(mediaUrl, {
      headers: { Authorization: authHeader },
    })
    if (!mediaResponse.ok) {
      throw new Error(
        `Failed to download Twilio media (${mediaResponse.status}) for ${mediaUrl}`
      )
    }

    const storagePath = `${prefix}/${filename}`
    const buffer = Buffer.from(await mediaResponse.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from(MESSAGE_MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      })

    if (uploadError) throw uploadError

    existingNames.add(filename)
    insertedCount += 1
  }

  return insertedCount
}

async function syncRecentMessages({ supabase, company, limit }) {
  const client = twilio(
    company.twilio_account_sid,
    company.twilio_auth_token
  )
  const authHeader = `Basic ${Buffer.from(
    `${company.twilio_account_sid}:${company.twilio_auth_token}`
  ).toString('base64')}`

  const recentMessages = await client.messages.list({
    to: company.twilio_phone_number,
    limit,
  })

  const inboundMessages = recentMessages
    .filter((message) => String(message.direction ?? '').startsWith('inbound'))
    .sort((a, b) => {
      const aTime = new Date(a.dateCreated ?? 0).getTime()
      const bTime = new Date(b.dateCreated ?? 0).getTime()
      return aTime - bTime
    })

  const result = {
    company: {
      id: company.id,
      name: company.name,
      phone: company.twilio_phone_number,
    },
    checked: inboundMessages.length,
    insertedMessages: 0,
    insertedMedia: 0,
    latestRecovered: null,
  }

  for (const message of inboundMessages) {
    const from = message.from
    const to = message.to
    if (!from || !to) continue

    const receivedAt = (
      message.dateSent ||
      message.dateCreated ||
      new Date()
    ).toISOString()
    const body = message.body || ''
    const messageSid = message.sid

    const { data: existingMessage, error: existingError } = await supabase
      .from('sent_messages')
      .select('id, job_id, twilio_sid')
      .eq('company_id', company.id)
      .eq('twilio_sid', messageSid)
      .maybeSingle()

    if (existingError) throw existingError

    const job = await findBestJobForPhone(supabase, company.id, from)
    const legacyMessage = await findLegacyInboundMessageCandidate({
      supabase,
      body,
      companyId: company.id,
      from,
      receivedAt,
      to,
    })
    const isNewMessage = !existingMessage && !legacyMessage

    await syncConversationForInbound({
      supabase,
      companyId: company.id,
      customerPhone: from,
      jobId: job?.id ?? null,
      receivedAt,
      shouldIncrementUnread: isNewMessage,
    })

    let sentMessageId = existingMessage?.id ?? null

    if (sentMessageId && legacyMessage) {
      const { error: deleteError } = await supabase
        .from('sent_messages')
        .delete()
        .eq('id', legacyMessage.id)

      if (deleteError) throw deleteError
    } else if (!sentMessageId && legacyMessage) {
      const { data: updatedMessage, error: updateError } = await supabase
        .from('sent_messages')
        .update({
          job_id: legacyMessage.job_id ?? job?.id ?? null,
          twilio_sid: messageSid,
        })
        .eq('id', legacyMessage.id)
        .select('id')
        .single()

      if (updateError) throw updateError
      sentMessageId = updatedMessage.id
    } else if (!sentMessageId) {
      const { data: insertedMessage, error: insertError } = await supabase
        .from('sent_messages')
        .insert({
          company_id: company.id,
          job_id: job?.id ?? null,
          plan_id: null,
          direction: 'inbound',
          body,
          to_phone: to,
          from_phone: from,
          twilio_sid: messageSid,
          sent_at: receivedAt,
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      sentMessageId = insertedMessage.id
      result.insertedMessages += 1
      result.latestRecovered = {
        from,
        sentAt: receivedAt,
        twilioSid: messageSid,
      }
    }

    const numMedia = Number.parseInt(String(message.numMedia ?? '0'), 10)
    if (numMedia > 0 && sentMessageId) {
      const mediaItems = await client.messages(message.sid).media.list({ limit: 10 })
      result.insertedMedia += await storeMedia({
        supabase,
        authHeader,
        companyId: company.id,
        mediaItems,
        messageId: sentMessageId,
        messageSid,
      })
    }
  }

  return result
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const companySelector = argValue('--company')
  const limit = Number.parseInt(argValue('--limit', '20'), 10)

  const company = await pickCompany(supabase, companySelector)
  const result = await syncRecentMessages({
    supabase,
    company,
    limit: Number.isFinite(limit) ? limit : 20,
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
