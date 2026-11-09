import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseImportedRows } from '@/lib/jobs/import'
import { testMotherBrainConnection } from '@/lib/motherBrain'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'

export async function POST() {
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

    if (company.name !== ALLIED_COMPANY_NAME) {
      return NextResponse.json({ error: 'Mother Brain import is only enabled for Allied Restoration Services.' }, { status: 403 })
    }

    const connection = await testMotherBrainConnection()

    return NextResponse.json({
      ok: true,
      datasetVersionId: connection.datasetVersionId,
      allowedColumns: connection.allowedColumns,
      missingColumns: connection.missingColumns,
      preview: parseImportedRows(connection.rows).preview,
    })
  } catch (error) {
    console.error('[mother-brain/test] Failed to test connection:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach Mother Brain.' },
      { status: 500 }
    )
  }
}
