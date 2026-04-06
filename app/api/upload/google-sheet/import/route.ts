import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readGoogleSheet } from '@/lib/googleSheets'
import { importParsedJobs, parseImportedRows } from '@/lib/jobs/import'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetUrl } = (await request.json()) as { sheetUrl?: string }
    if (!sheetUrl?.trim()) {
      return NextResponse.json({ error: 'Enter a Google Sheets link first.' }, { status: 400 })
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

    if (company.name !== ALLIED_COMPANY_NAME) {
      return NextResponse.json({ error: 'Google Sheets import is only enabled for Allied Restoration Services.' }, { status: 403 })
    }

    const sheet = await readGoogleSheet(sheetUrl)
    const parsed = parseImportedRows(sheet.rows)

    if (parsed.parsed.length === 0) {
      return NextResponse.json({ error: 'The selected sheet did not contain any importable rows.' }, { status: 400 })
    }

    const result = await importParsedJobs(admin, company.id, parsed.parsed)

    await admin
      .from('companies')
      .update({
        google_sheet_url: sheetUrl.trim(),
        google_sheet_last_imported_at: new Date().toISOString(),
      })
      .eq('id', company.id)

    return NextResponse.json({
      ok: true,
      count: result.count,
      totalRows: sheet.totalRows,
      spreadsheetTitle: sheet.spreadsheetTitle,
      worksheetTitle: sheet.worksheetTitle,
      warningCount: parsed.rowErrors.length,
    })
  } catch (error) {
    console.error('[google-sheet/import] Failed to import sheet:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import the Google Sheet.' },
      { status: 500 }
    )
  }
}
