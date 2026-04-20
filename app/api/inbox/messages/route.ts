import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listStoredMessageAttachments } from '@/lib/messages/attachments'
import type { SentMessage } from '@/lib/supabase/types'

type MessageRow = SentMessage & {
  message_media: Awaited<ReturnType<typeof listStoredMessageAttachments>>
}

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json(
      { error: 'conversationId is required' },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: userRow, error: userError } = await admin
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (userError || !userRow) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .select('id, company_id, customer_phone')
    .eq('id', conversationId)
    .eq('company_id', userRow.company_id)
    .single()

  if (conversationError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data: messages, error: messagesError } = await admin
    .from('sent_messages')
    .select('*')
    .eq('company_id', conversation.company_id)
    .or(
      `to_phone.eq.${conversation.customer_phone},from_phone.eq.${conversation.customer_phone}`
    )
    .order('sent_at', { ascending: true })

  if (messagesError) {
    return NextResponse.json(
      { error: 'Could not load messages' },
      { status: 500 }
    )
  }

  const enrichedMessages: MessageRow[] = await Promise.all(
    (messages ?? []).map(async (message) => ({
      ...message,
      message_media: await listStoredMessageAttachments(admin, {
        companyId: conversation.company_id,
        direction: message.direction,
        messageId: message.id,
        twilioSid: message.twilio_sid,
      }),
    }))
  )

  return NextResponse.json({ messages: enrichedMessages })
}
