import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importParsedJobs, parseImportedRows } from '@/lib/jobs/import'
import { isMotherBrainConfigured, readMotherBrainJobs } from '@/lib/motherBrain'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'
const PACIFIC_TIMEZONE = 'America/Los_Angeles'
export const maxDuration = 60

export async function POST() {
  const internalSecret = process.env.INTERNAL_CRON_SECRET
  const secret = (await headers()).get('x-internal-cron-secret')

  if (!internalSecret || secret !== internalSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    if (!isMotherBrainConfigured()) {
      console.warn('[mother-brain-sync] Skipped: Mother Brain env vars are not set.')
      return NextResponse.json({ ok: true, skipped: true, reason: 'Mother Brain is not configured.' })
    }

    const admin = createAdminClient()
    const { data: company, error } = await admin
      .from('companies')
      .select('id, name, google_sheet_last_imported_at')
      .eq('name', ALLIED_COMPANY_NAME)
      .single()

    if (error || !company) {
      return NextResponse.json({ ok: false, error: 'Allied company record not found.' }, { status: 404 })
    }

    if (hasImportedTodayPacific(company.google_sheet_last_imported_at)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Already imported today.' })
    }

    const source = await readMotherBrainJobs()
    const parsed = parseImportedRows(source.rows)

    if (parsed.parsed.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Mother Brain returned no importable rows.' })
    }

    const result = await importParsedJobs(admin, company.id, parsed.parsed, {
      reconcileInbox: false,
    })

    // Column name predates Mother Brain; it records the last job import from any source.
    await admin
      .from('companies')
      .update({ google_sheet_last_imported_at: new Date().toISOString() })
      .eq('id', company.id)

    return NextResponse.json({
      ok: true,
      imported: result.count,
      datasetVersionId: source.datasetVersionId,
      duplicatesDropped: source.duplicatesDropped,
      warningCount: parsed.rowErrors.length,
    })
  } catch (error) {
    console.error('[mother-brain-sync] Failed to run scheduled import:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Scheduled import failed.' },
      { status: 500 }
    )
  }
}

function hasImportedTodayPacific(importedAt: string | null) {
  if (!importedAt) return false
  return pacificDateKey(importedAt) === pacificDateKey(new Date().toISOString())
}

function pacificDateKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}
