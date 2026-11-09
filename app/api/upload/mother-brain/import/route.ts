import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'

// Starts the import in netlify/functions/mother-brain-import-background.ts and
// returns at once: a full import takes longer than a route is allowed to run.
// The upload page waits for companies.google_sheet_last_imported_at to change.
export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'User record not found.' }, { status: 403 })
    }

    const { data: company, error: companyError } = await admin
      .from('companies')
      .select('id, name')
      .eq('id', userRow.company_id)
      .single()

    if (companyError || !company) {
      return NextResponse.json({ error: 'Company not found.' }, { status: 403 })
    }

    // Mother Brain holds Allied's Albi jobs only, so no other company may import them.
    if (company.name !== ALLIED_COMPANY_NAME) {
      return NextResponse.json({ error: 'Mother Brain import is only enabled for Allied Restoration Services.' }, { status: 403 })
    }

    const secret = process.env.INTERNAL_CRON_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'Missing INTERNAL_CRON_SECRET.' }, { status: 500 })
    }

    const response = await fetch(new URL('/.netlify/functions/mother-brain-import-background', request.nextUrl.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-cron-secret': secret },
      body: JSON.stringify({ force: true }),
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: `Could not start the import (HTTP ${response.status}).` }, { status: 502 })
    }

    return NextResponse.json({ ok: true, started: true }, { status: 202 })
  } catch (error) {
    console.error('[mother-brain/import] Failed to start import:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start the Mother Brain import.' },
      { status: 500 }
    )
  }
}
