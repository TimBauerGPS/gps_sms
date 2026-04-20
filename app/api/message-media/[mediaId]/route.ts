import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  decodeAttachmentId,
  MESSAGE_MEDIA_BUCKET,
} from '@/lib/messages/attachments'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params

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

  const storagePath = decodeAttachmentId(mediaId)
  if (!storagePath.startsWith(`${userRow.company_id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: file, error: downloadError } = await admin.storage
    .from(MESSAGE_MEDIA_BUCKET)
    .download(storagePath)

  if (downloadError || !file) {
    return NextResponse.json({ error: 'File unavailable' }, { status: 404 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const safeFilename =
    storagePath.split('/').pop()?.replace(/"/g, '') || 'attachment'

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${safeFilename}"`,
      'Content-Type': file.type || 'application/octet-stream',
    },
  })
}
