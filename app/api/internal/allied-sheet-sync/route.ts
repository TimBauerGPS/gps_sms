import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readGoogleSheet } from '@/lib/googleSheets'
import { importParsedJobs, parseImportedRows } from '@/lib/jobs/import'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'
const PACIFIC_TIMEZONE = 'America/Los_Angeles'

export async function POST() {
  const internalSecret = process.env.INTERNAL_CRON_SECRET
  const secret = (await headers()).get('x-internal-cron-secret')

  if (!internalSecret || secret !== internalSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const { data: company, error } = await admin
      .from('companies')
      .select('id, name, google_sheet_url, google_sheet_last_imported_at')
      .eq('name', ALLIED_COMPANY_NAME)
      .single()

    if (error || !company) {
      return NextResponse.json({ ok: false, error: 'Allied company record not found.' }, { status: 404 })
    }

    if (!company.google_sheet_url) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No Google Sheet URL configured.' })
    }

    if (hasImportedTodayPacific(company.google_sheet_last_imported_at)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Already imported today.' })
    }

    const sheet = await readGoogleSheet(company.google_sheet_url)
    const parsed = parseImportedRows(sheet.rows)

    if (parsed.parsed.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Sheet contained no importable rows.' })
    }

    const result = await importParsedJobs(admin, company.id, parsed.parsed)

    await admin
      .from('companies')
      .update({ google_sheet_last_imported_at: new Date().toISOString() })
      .eq('id', company.id)

    return NextResponse.json({
      ok: true,
      imported: result.count,
      spreadsheetTitle: sheet.spreadsheetTitle,
      worksheetTitle: sheet.worksheetTitle,
      warningCount: parsed.rowErrors.length,
    })
  } catch (error) {
    console.error('[allied-sheet-sync] Failed to run scheduled import:', error)
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
