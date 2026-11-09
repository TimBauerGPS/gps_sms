import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importParsedJobs, parseImportedRows } from '@/lib/jobs/import'
import { readMotherBrainJobs } from '@/lib/motherBrain'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'
export const maxDuration = 60

export async function POST() {
  const startedAt = Date.now()
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

    const source = await readMotherBrainJobs()
    const afterReadAt = Date.now()
    const parsed = parseImportedRows(source.rows)
    const afterParseAt = Date.now()

    if (parsed.parsed.length === 0) {
      return NextResponse.json({ error: 'Mother Brain did not return any importable rows.' }, { status: 400 })
    }

    const result = await importParsedJobs(admin, company.id, parsed.parsed, {
      batchSize: 500,
      reconcileInbox: false,
    })
    const afterImportAt = Date.now()

    // Column name predates Mother Brain; it records the last job import from any source.
    await admin
      .from('companies')
      .update({ google_sheet_last_imported_at: new Date().toISOString() })
      .eq('id', company.id)

    console.log('[mother-brain/import] Completed import', {
      companyId: company.id,
      datasetVersionId: source.datasetVersionId,
      parsedRows: parsed.parsed.length,
      duplicatesDropped: source.duplicatesDropped,
      warningCount: parsed.rowErrors.length,
      msReadMotherBrain: afterReadAt - startedAt,
      msParseRows: afterParseAt - afterReadAt,
      msImportJobs: afterImportAt - afterParseAt,
      msTotal: Date.now() - startedAt,
    })

    return NextResponse.json({
      ok: true,
      count: result.count,
      duplicatesDropped: source.duplicatesDropped,
      warningCount: parsed.rowErrors.length,
    })
  } catch (error) {
    console.error('[mother-brain/import] Failed to import jobs:', {
      error,
      msTotal: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import from Mother Brain.' },
      { status: 500 }
    )
  }
}
