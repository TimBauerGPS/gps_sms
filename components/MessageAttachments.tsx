import type { MessageAttachment } from '@/lib/messages/attachments'

type Tone = 'light' | 'dark'

function formatFileSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null

  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  return (attachment.mime_type ?? '').startsWith('image/')
}

function fallbackAttachmentLabel(attachment: MessageAttachment): string {
  const mimeType = (attachment.mime_type ?? '').toLowerCase()
  if (mimeType === 'text/x-vcard' || mimeType === 'text/vcard') {
    return 'Contact card'
  }
  if (attachment.filename) return attachment.filename
  if (attachment.mime_type) return attachment.mime_type
  return 'Attachment'
}

export default function MessageAttachments({
  attachments,
  compact = false,
  tone = 'light',
}: {
  attachments: MessageAttachment[]
  compact?: boolean
  tone?: Tone
}) {
  if (attachments.length === 0) return null

  const linkClass =
    tone === 'dark'
      ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
  const contactCardClass =
    tone === 'dark'
      ? 'border-white/20 bg-white/10 text-white'
      : 'border-slate-200 bg-white text-slate-700'
  const imageClass = compact
    ? 'max-h-24 max-w-[9rem]'
    : 'max-h-56 max-w-[16rem]'

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const href = `/api/message-media/${attachment.id}`

        if (isImageAttachment(attachment)) {
          return (
            <a
              key={attachment.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={href}
                alt={fallbackAttachmentLabel(attachment)}
                className={`block h-auto w-auto object-cover ${imageClass}`}
                loading="lazy"
              />
            </a>
          )
        }

        if (attachment.vcard_preview) {
          const preview = attachment.vcard_preview
          const title = preview.name || 'Contact card'

          return (
            <a
              key={attachment.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`min-w-[13rem] rounded-xl border px-3 py-2 transition-colors ${contactCardClass}`}
            >
              <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">
                Contact card
              </div>
              <div className="mt-1 text-sm font-semibold">{title}</div>
              {preview.phones.length > 0 ? (
                <div className="mt-1 space-y-0.5 text-xs opacity-80">
                  {preview.phones.map((phone) => (
                    <div key={`${attachment.id}-${phone}`}>{phone}</div>
                  ))}
                </div>
              ) : null}
            </a>
          )
        }

        const sizeLabel = formatFileSize(attachment.file_size_bytes)

        return (
          <a
            key={attachment.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${linkClass}`}
          >
            <span>{fallbackAttachmentLabel(attachment)}</span>
            {sizeLabel ? <span className="opacity-70">{sizeLabel}</span> : null}
          </a>
        )
      })}
    </div>
  )
}
