import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuardianAdminContext } from '@/lib/adminAccess'

export async function POST(req: NextRequest) {
  const context = await getGuardianAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!context.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { requestId } = await req.json()
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('signup_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
