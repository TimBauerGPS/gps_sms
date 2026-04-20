import type { SupabaseClient } from '@supabase/supabase-js'
import { parseVCardPreview, type VCardPreview } from '@/lib/messages/vcard'
import type { Database } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

type AttachmentSource = {
  companyId: string
  direction: 'inbound' | 'outbound'
  messageId: string
  twilioSid: string | null
}

export type MessageAttachment = {
  id: string
  filename: string | null
  mime_type: string | null
  file_size_bytes: number | null
  vcard_preview: VCardPreview | null
}

export const MESSAGE_MEDIA_BUCKET = 'message-media'

export function encodeAttachmentId(storagePath: string): string {
  return Buffer.from(storagePath, 'utf8').toString('base64url')
}

export function decodeAttachmentId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8')
}

export function getMessageMediaPrefix({
  companyId,
  messageId,
  twilioSid,
}: {
  companyId: string
  messageId: string
  twilioSid: string | null
}): string {
  return `${companyId}/${twilioSid ?? messageId}`
}

function attachmentStem(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex)
}

function attachmentPreference(filename: string): number {
  if (filename.endsWith('.vcf')) return 2
  if (filename.endsWith('.x-vcard')) return 1
  return 0
}

export async function ensureMessageMediaBucket(admin: AdminClient) {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(
    MESSAGE_MEDIA_BUCKET
  )

  if (bucket) return

  const shouldCreate =
    !bucketError || /not found|does not exist/i.test(bucketError.message)

  if (!shouldCreate) {
    throw bucketError
  }

  const { error: createError } = await admin.storage.createBucket(
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

export async function listStoredMessageAttachments(
  admin: AdminClient,
  source: AttachmentSource
): Promise<MessageAttachment[]> {
  if (source.direction !== 'inbound' || !source.twilioSid) {
    return []
  }

  await ensureMessageMediaBucket(admin)

  const prefix = getMessageMediaPrefix(source)
  const { data, error } = await admin.storage
    .from(MESSAGE_MEDIA_BUCKET)
    .list(prefix, {
      limit: 10,
      sortBy: { column: 'name', order: 'asc' },
    })

  if (error) {
    if (/not found|does not exist/i.test(error.message)) {
      return []
    }
    throw error
  }

  const preferredFiles = new Map<string, (typeof data)[number]>()

  for (const item of data ?? []) {
    if (!item.name) continue
    const stem = attachmentStem(item.name)
    const current = preferredFiles.get(stem)
    if (!current) {
      preferredFiles.set(stem, item)
      continue
    }

    if (attachmentPreference(item.name) > attachmentPreference(current.name ?? '')) {
      preferredFiles.set(stem, item)
    }
  }

  return Promise.all(
    Array.from(preferredFiles.values())
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .map(async (item) => {
      const metadata = (item.metadata ?? {}) as {
        mimetype?: string
        size?: number | string
      }
      const fileSize =
        metadata.size == null
          ? null
          : Number.parseInt(String(metadata.size), 10)
      const storagePath = `${prefix}/${item.name}`

      let vcardPreview: VCardPreview | null = null
      if (metadata.mimetype === 'text/x-vcard' || metadata.mimetype === 'text/vcard') {
        const { data: file, error: downloadError } = await admin.storage
          .from(MESSAGE_MEDIA_BUCKET)
          .download(storagePath)

        if (!downloadError && file) {
          vcardPreview = parseVCardPreview(await file.text())
        }
      }

      return {
        id: encodeAttachmentId(storagePath),
        filename: item.name ?? null,
        mime_type: metadata.mimetype ?? null,
        file_size_bytes: Number.isFinite(fileSize) ? fileSize : null,
        vcard_preview: vcardPreview,
      }
    })
  )
}
