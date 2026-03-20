import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authSupabase = await createClient()
    const {
      data: { user },
    } = await authSupabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    const { data: userRow } = await admin
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (!userRow) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 })
    }

    const companyId = userRow.company_id

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json()
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : []

    if (!ids.length) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
    }

    // ── Update rows (must belong to this company and be pending) ────────────
    const { data: updated, error: updateError } = await admin
      .from('send_queue')
      .update({
        status: 'skipped',
        skipped_reason: 'user removed',
        processed_at: new Date().toISOString(),
      })
      .in('id', ids)
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .select('id')

    if (updateError) {
      console.error('[send-queue/skip] Update error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const skipped = updated?.length ?? 0

    return NextResponse.json({ skipped })
  } catch (err) {
    console.error('[send-queue/skip] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
