import type { SupabaseClient } from '@supabase/supabase-js'
import { findBestJobForPhone } from '@/lib/inbox/reconcile'
import {
  ensureMessageMediaBucket,
  getMessageMediaPrefix,
  MESSAGE_MEDIA_BUCKET,
} from '@/lib/messages/attachments'
import type { Database } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

type CompanyRecord = Pick<
  Database['public']['Tables']['companies']['Row'],
  | 'id'
  | 'twilio_account_sid'
  | 'twilio_auth_token'
>

type ExistingConversation = Pick<
  Database['public']['Tables']['conversations']['Row'],
  'id' | 'job_id' | 'last_message_at' | 'unread_count'
>

type ExistingSentMessage = Pick<
  Database['public']['Tables']['sent_messages']['Row'],
  'id' | 'job_id' | 'twilio_sid'
>

export type InboundMediaItem = {
  contentType: string | null
  index: number
  mediaUrl: string
}

export type SyncInboundTwilioMessageParams = {
  admin: AdminClient
  body: string
  company: CompanyRecord
  from: string
  mediaItems: InboundMediaItem[]
  messageSid: string | null
  receivedAt: string
  to: string
}

function extractMediaSid(mediaUrl: string): string | null {
  const match = mediaUrl.match(/\/Media\/([^/?]+)/i)
  return match?.[1] ?? null
}

function extensionForMimeType(mimeType: string | null): string {
  const normalized = (mimeType ?? '').split(';')[0].trim().toLowerCase()

  switch (normalized) {
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
      const suffix = normalized.split('/')[1]
      return suffix ? suffix.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'bin'
    }
  }
}

function pickLatestTimestamp(currentValue: string, incomingValue: string): string {
  const currentTime = new Date(currentValue).getTime()
  const incomingTime = new Date(incomingValue).getTime()

  if (Number.isNaN(currentTime)) return incomingValue
  if (Number.isNaN(incomingTime)) return currentValue
  return incomingTime > currentTime ? incomingValue : currentValue
}

async function findLegacyInboundMessageCandidate({
  admin,
  body,
  companyId,
  from,
  receivedAt,
  to,
}: {
  admin: AdminClient
  body: string
  companyId: string
  from: string
  receivedAt: string
  to: string
}) {
  const receivedTime = new Date(receivedAt).getTime()
  const tenMinutesMs = 10 * 60 * 1000
  const windowStart = new Date(receivedTime - tenMinutesMs).toISOString()
  const windowEnd = new Date(receivedTime + tenMinutesMs).toISOString()

  const { data, error } = await admin
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

  if (error) {
    throw error
  }

  return data?.[0] ?? null
}

async function syncConversationForInbound({
  admin,
  companyId,
  customerPhone,
  jobId,
  receivedAt,
  shouldIncrementUnread,
}: {
  admin: AdminClient
  companyId: string
  customerPhone: string
  jobId: string | null
  receivedAt: string
  shouldIncrementUnread: boolean
}) {
  const { data: conversation, error: fetchError } = await admin
    .from('conversations')
    .select('id, job_id, last_message_at, unread_count')
    .eq('company_id', companyId)
    .eq('customer_phone', customerPhone)
    .maybeSingle<ExistingConversation>()

  if (fetchError) {
    throw fetchError
  }

  if (!conversation) {
    const { error: insertError } = await admin.from('conversations').insert({
      company_id: companyId,
      customer_phone: customerPhone,
      job_id: jobId,
      last_message_at: receivedAt,
      unread_count: shouldIncrementUnread ? 1 : 0,
    })

    if (insertError) {
      throw insertError
    }

    return
  }

  const nextJobId = conversation.job_id ?? jobId
  const nextLastMessageAt = pickLatestTimestamp(
    conversation.last_message_at,
    receivedAt
  )
  const nextUnreadCount = shouldIncrementUnread
    ? conversation.unread_count + 1
    : conversation.unread_count

  const { error: updateError } = await admin
    .from('conversations')
    .update({
      job_id: nextJobId,
      last_message_at: nextLastMessageAt,
      unread_count: nextUnreadCount,
    })
    .eq('id', conversation.id)

  if (updateError) {
    throw updateError
  }
}

async function storeInboundMedia({
  admin,
  company,
  mediaItems,
  messageId,
  messageSid,
}: {
  admin: AdminClient
  company: CompanyRecord
  mediaItems: InboundMediaItem[]
  messageId: string
  messageSid: string | null
}) {
  if (
    mediaItems.length === 0 ||
    !company.twilio_account_sid ||
    !company.twilio_auth_token
  ) {
    return 0
  }

  await ensureMessageMediaBucket(admin)

  const prefix = getMessageMediaPrefix({
    companyId: company.id,
    messageId,
    twilioSid: messageSid,
  })
  const { data: existingFiles, error: listError } = await admin.storage
    .from(MESSAGE_MEDIA_BUCKET)
    .list(prefix, {
      limit: 10,
      sortBy: { column: 'name', order: 'asc' },
    })

  if (listError && !/not found|does not exist/i.test(listError.message)) {
    throw listError
  }

  const existingNames = new Set((existingFiles ?? []).map((file) => file.name))

  const authHeader = `Basic ${Buffer.from(
    `${company.twilio_account_sid}:${company.twilio_auth_token}`
  ).toString('base64')}`

  let insertedCount = 0

  for (const mediaItem of mediaItems) {
    const twilioMediaSid = extractMediaSid(mediaItem.mediaUrl)
    const mediaResponse = await fetch(mediaItem.mediaUrl, {
      headers: { Authorization: authHeader },
    })

    if (!mediaResponse.ok) {
      throw new Error(
        `Failed to download Twilio media (${mediaResponse.status}) for ${mediaItem.mediaUrl}`
      )
    }

    const mimeType =
      mediaResponse.headers.get('content-type')?.split(';')[0].trim() ||
      mediaItem.contentType ||
      'application/octet-stream'
    const extension = extensionForMimeType(mimeType)
    const fileStem = twilioMediaSid || `media-${mediaItem.index + 1}`
    const filename = `${fileStem}.${extension}`
    if (existingNames.has(filename)) {
      continue
    }

    const storagePath = `${prefix}/${filename}`
    const buffer = Buffer.from(await mediaResponse.arrayBuffer())

    const { error: uploadError } = await admin.storage
      .from(MESSAGE_MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      })

    if (uploadError) {
      throw uploadError
    }

    existingNames.add(filename)
    insertedCount += 1
  }

  return insertedCount
}

export function extractInboundMediaFromParams(params: URLSearchParams): InboundMediaItem[] {
  const numMedia = Number.parseInt(params.get('NumMedia') ?? '0', 10)

  if (!Number.isFinite(numMedia) || numMedia <= 0) {
    return []
  }

  const mediaItems: InboundMediaItem[] = []

  for (let index = 0; index < numMedia; index += 1) {
    const mediaUrl = params.get(`MediaUrl${index}`)
    if (!mediaUrl) continue

    mediaItems.push({
      contentType: params.get(`MediaContentType${index}`),
      index,
      mediaUrl,
    })
  }

  return mediaItems
}

export async function syncInboundTwilioMessage({
  admin,
  body,
  company,
  from,
  mediaItems,
  messageSid,
  receivedAt,
  to,
}: SyncInboundTwilioMessageParams) {
  const job = await findBestJobForPhone(admin, company.id, from)

  let sentMessage: ExistingSentMessage | null = null
  if (messageSid) {
    const { data, error } = await admin
      .from('sent_messages')
      .select('id, job_id, twilio_sid')
      .eq('company_id', company.id)
      .eq('twilio_sid', messageSid)
      .maybeSingle<ExistingSentMessage>()

    if (error) {
      throw error
    }

    sentMessage = data
  }

  const legacyMessage = await findLegacyInboundMessageCandidate({
    admin,
    body,
    companyId: company.id,
    from,
    receivedAt,
    to,
  })

  const shouldIncrementUnread = !sentMessage

  await syncConversationForInbound({
    admin,
    companyId: company.id,
    customerPhone: from,
    jobId: job?.id ?? null,
    receivedAt,
    shouldIncrementUnread,
  })

  if (sentMessage && legacyMessage) {
    const { error } = await admin
      .from('sent_messages')
      .delete()
      .eq('id', legacyMessage.id)

    if (error) {
      throw error
    }
  } else if (!sentMessage && legacyMessage) {
    const { data, error } = await admin
      .from('sent_messages')
      .update({
        job_id: legacyMessage.job_id ?? job?.id ?? null,
        twilio_sid: messageSid,
      })
      .eq('id', legacyMessage.id)
      .select('id, job_id, twilio_sid')
      .single<ExistingSentMessage>()

    if (error) {
      throw error
    }

    sentMessage = data
  } else if (!sentMessage) {
    const { data, error } = await admin
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
      .select('id, job_id, twilio_sid')
      .single<ExistingSentMessage>()

    if (error) {
      throw error
    }

    sentMessage = data
  } else if (job?.id && !sentMessage.job_id) {
    const { error } = await admin
      .from('sent_messages')
      .update({ job_id: job.id })
      .eq('id', sentMessage.id)

    if (error) {
      throw error
    }

    sentMessage = { ...sentMessage, job_id: job.id }
  }

  const insertedMediaCount = await storeInboundMedia({
    admin,
    company,
    mediaItems,
    messageId: sentMessage.id,
    messageSid,
  })

  return {
    insertedMediaCount,
    isNewMessage: shouldIncrementUnread,
    job,
    sentMessageId: sentMessage.id,
  }
}
