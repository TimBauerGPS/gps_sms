// Netlify background function (the -background suffix gives it up to 15 minutes).
// A full Mother Brain import is ~15k jobs and doesn't fit in a 60-second route.
// Netlify answers the caller with 202 at once, so results are only in the logs,
// and success shows up as a new companies.google_sheet_last_imported_at.
import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { importParsedJobs, parseImportedRows } from '../../lib/jobs/import'
import { isMotherBrainConfigured, readMotherBrainJobs } from '../../lib/motherBrain'
import type { Database } from '../../lib/supabase/types'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'
const PACIFIC_TIMEZONE = 'America/Los_Angeles'

interface HandlerEvent {
  httpMethod: string
  headers: Record<string, string | undefined>
  body: string | null
}

export const handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST' || !validSecret(event.headers['x-internal-cron-secret'])) {
    return { statusCode: 401, body: '' }
  }

  // Never rethrow: Netlify retries failed background functions, and an import
  // that failed once (bad key, missing column) would just fail again.
  try {
    await runImport(readForce(event.body))
  } catch (error) {
    console.error('[mother-brain-import] Import failed:', error)
  }

  return { statusCode: 200, body: '' }
}

async function runImport(force: boolean) {
  const startedAt = Date.now()

  if (!isMotherBrainConfigured()) {
    console.warn('[mother-brain-import] Skipped: Mother Brain env vars are not set.')
    return
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  }
  const admin = createClient<Database>(supabaseUrl, serviceRoleKey)

  const { data: company, error } = await admin
    .from('companies')
    .select('id, google_sheet_last_imported_at')
    .eq('name', ALLIED_COMPANY_NAME)
    .single()

  if (error || !company) {
    throw new Error('Allied company record not found.')
  }

  // The nightly run imports once a day; a manual import from /upload always runs.
  if (!force && hasImportedTodayPacific(company.google_sheet_last_imported_at)) {
    console.log('[mother-brain-import] Skipped: already imported today.')
    return
  }

  const source = await readMotherBrainJobs()
  const afterReadAt = Date.now()
  const parsed = parseImportedRows(source.rows)

  if (parsed.parsed.length === 0) {
    console.warn('[mother-brain-import] Skipped: Mother Brain returned no importable rows.')
    return
  }

  const result = await importParsedJobs(admin, company.id, parsed.parsed, {
    batchSize: 500,
    reconcileInbox: false,
  })
  const afterImportAt = Date.now()

  // Column name predates Mother Brain; it records the last job import from any source.
  const { error: updateError } = await admin
    .from('companies')
    .update({ google_sheet_last_imported_at: new Date().toISOString() })
    .eq('id', company.id)

  if (updateError) {
    throw new Error(updateError.message)
  }

  console.log('[mother-brain-import] Completed import', {
    trigger: force ? 'manual' : 'nightly',
    datasetVersionId: source.datasetVersionId,
    imported: result.count,
    duplicatesDropped: source.duplicatesDropped,
    warningCount: parsed.rowErrors.length,
    msReadMotherBrain: afterReadAt - startedAt,
    msImportJobs: afterImportAt - afterReadAt,
    msTotal: Date.now() - startedAt,
  })
}

function validSecret(received: string | undefined) {
  const expected = process.env.INTERNAL_CRON_SECRET
  if (!expected || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readForce(body: string | null) {
  try {
    return JSON.parse(body ?? '{}').force === true
  } catch {
    return false
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
