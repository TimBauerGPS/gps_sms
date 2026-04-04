import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileInboxForPhones } from '@/lib/inbox/reconcile'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { phones } = (await request.json().catch(() => ({}))) as {
      phones?: string[]
    }

    const admin = createAdminClient()

    const { data: userRow, error: userError } = await admin
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (userError || !userRow?.company_id) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 403 })
    }

    const result = await reconcileInboxForPhones(admin, userRow.company_id, phones ?? [])

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[inbox/reconcile] Failed to reconcile inbox:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to reconcile inbox records' },
      { status: 500 }
    )
  }
}
