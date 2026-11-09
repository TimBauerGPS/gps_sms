// Server-side only. Never import this from a Client Component: it reads
// MOTHER_BRAIN_API_KEY, which must not reach the browser.

type MotherBrainRow = Record<string, string>

interface MotherBrainQuery {
  select?: string[]
  limit?: number
  offset?: number
  datasetVersionId?: string
}

interface MotherBrainBody {
  columns?: string[]
  rows?: MotherBrainRow[]
  error?: {
    code?: string
    message?: string
    details?: { columns?: string[] }
  }
}

const PAGE_SIZE = 1000
const VERSION_HEADER = 'X-Motherbrain-Dataset-Version'

// Columns the import can't work without. Header names match mapHeader() in
// lib/jobs/import.ts, so rows go through the same import as a CSV. Any other
// column the API key allows is also imported, for template placeholders.
// Keep in sync with docs/mother-brain-columns-needed.md.
export const MOTHER_BRAIN_REQUIRED_COLUMNS = [
  'Name',
  'Customer',
  'Customer Phone Number',
  'Status',
  'Link to Project',
  'Created At',
  'Inspection Date',
  'Estimated Work Start Date',
  'File Closed',
  'Estimate sent',
  'Contract Signed',
  'COC/COS Signed',
  'Invoiced',
  'Work Start',
  'Paid',
  'Estimated Completion Date',
]

export function isMotherBrainConfigured() {
  return Boolean(process.env.MOTHER_BRAIN_BASE_URL && process.env.MOTHER_BRAIN_API_KEY)
}

async function queryMotherBrain(query: MotherBrainQuery) {
  const baseUrl = requiredEnv('MOTHER_BRAIN_BASE_URL').replace(/\/+$/, '')
  const apiKey = requiredEnv('MOTHER_BRAIN_API_KEY')

  const response = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(query),
    cache: 'no-store',
  })

  const body = await readBody(response)

  if (!response.ok) {
    const error = body.error ?? {}
    const columns = error.details?.columns?.length ? ` (${error.details.columns.join(', ')})` : ''
    throw new Error(
      `Mother Brain ${response.status} ${error.code ?? 'UNKNOWN_ERROR'}: ${error.message ?? 'Request failed.'}${columns}`
    )
  }

  return { body, datasetVersionId: response.headers.get(VERSION_HEADER) }
}

async function readBody(response: Response): Promise<MotherBrainBody> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}))
  }

  const text = await response.text().catch(() => '')
  return {
    error: {
      code: 'NON_JSON_RESPONSE',
      message: text.slice(0, 300) || `Mother Brain returned HTTP ${response.status}.`,
    },
  }
}

function assertRequiredColumns(columns: string[] | undefined) {
  const missing = MOTHER_BRAIN_REQUIRED_COLUMNS.filter((column) => !columns?.includes(column))
  if (missing.length > 0) {
    throw new Error(`The Mother Brain API key is missing required columns: ${missing.join(', ')}`)
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}.`)
  }
  return value
}

// Reads every job from one dataset snapshot, so a Mother Brain refresh during
// pagination can't mix rows from two versions.
export async function readMotherBrainJobs() {
  const rows: MotherBrainRow[] = []
  let datasetVersionId: string | undefined

  while (true) {
    // No select: take every column the key allows, so adding a column to the
    // key makes it available to templates without a code change.
    const page = await queryMotherBrain({
      limit: PAGE_SIZE,
      offset: rows.length,
      ...(datasetVersionId ? { datasetVersionId } : {}),
    })

    if (!page.datasetVersionId || (datasetVersionId && page.datasetVersionId !== datasetVersionId)) {
      throw new Error('Mother Brain dataset snapshot changed during import. Please try again.')
    }
    if (!datasetVersionId) assertRequiredColumns(page.body.columns)
    datasetVersionId = page.datasetVersionId

    const pageRows = page.body.rows ?? []
    rows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      return { datasetVersionId, ...toImportRows(rows) }
    }
  }
}

// Connection check for the upload page: reports what this key can read and
// previews a few jobs, without importing anything.
export async function testMotherBrainConnection() {
  const { body, datasetVersionId } = await queryMotherBrain({ limit: 1 })
  const allowedColumns = body.columns ?? []
  const missingColumns = MOTHER_BRAIN_REQUIRED_COLUMNS.filter((column) => !allowedColumns.includes(column))

  if (missingColumns.length > 0) {
    return { datasetVersionId, allowedColumns, missingColumns, rows: [] }
  }

  const sample = await queryMotherBrain({ limit: 5 })
  return {
    datasetVersionId,
    allowedColumns,
    missingColumns,
    rows: toImportRows(sample.body.rows ?? []).rows,
  }
}

// Shapes Mother Brain rows for parseImportedRows().
export function toImportRows(rows: MotherBrainRow[]) {
  const byName = new Map<string, MotherBrainRow>()
  const unnamed: MotherBrainRow[] = []

  for (const row of rows) {
    // Existing templates can use {{Customer Name}}, but Mother Brain calls it Customer.
    const importRow: MotherBrainRow = { ...row, 'Customer Name': row.Customer ?? '' }
    const name = row.Name?.trim()

    if (!name) {
      unnamed.push(importRow)
      continue
    }

    // Jobs upsert on Name, and Postgres rejects a batch that hits one row twice.
    // Created At is an ISO timestamp, so a string compare finds the newest.
    const existing = byName.get(name)
    if (!existing || (importRow['Created At'] ?? '') > (existing['Created At'] ?? '')) {
      byName.set(name, importRow)
    }
  }

  const importRows = [...byName.values(), ...unnamed]
  return { rows: importRows, duplicatesDropped: rows.length - importRows.length }
}
