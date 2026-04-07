export interface MessageHistoryRow {
  direction: 'inbound' | 'outbound'
  body: string
  to_phone: string
  from_phone: string
  sent_at: string | null
}

function normalizeMessageBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim()
}

function getConversationPhone(row: MessageHistoryRow): string {
  return row.direction === 'outbound' ? row.to_phone : row.from_phone
}

export function buildRepliedMessageSet(rows: MessageHistoryRow[]): Set<string> {
  const rowsByPhone = new Map<string, MessageHistoryRow[]>()

  for (const row of rows) {
    const phone = getConversationPhone(row)
    if (!phone) continue

    const existing = rowsByPhone.get(phone)
    if (existing) {
      existing.push(row)
    } else {
      rowsByPhone.set(phone, [row])
    }
  }

  const repliedMessages = new Set<string>()

  for (const [phone, phoneRows] of rowsByPhone) {
    phoneRows.sort((a, b) => {
      const aTime = a.sent_at ? Date.parse(a.sent_at) : 0
      const bTime = b.sent_at ? Date.parse(b.sent_at) : 0
      return aTime - bTime
    })

    const pendingOutboundBodies = new Set<string>()

    for (const row of phoneRows) {
      if (row.direction === 'outbound') {
        const normalizedBody = normalizeMessageBody(row.body)
        if (normalizedBody) {
          pendingOutboundBodies.add(normalizedBody)
        }
        continue
      }

      for (const normalizedBody of pendingOutboundBodies) {
        repliedMessages.add(`${phone}\u0000${normalizedBody}`)
      }
    }
  }

  return repliedMessages
}

export function hasRepliedToMessage(
  repliedMessages: Set<string>,
  phone: string,
  message: string
): boolean {
  const normalizedBody = normalizeMessageBody(message)
  if (!phone || !normalizedBody) return false
  return repliedMessages.has(`${phone}\u0000${normalizedBody}`)
}
