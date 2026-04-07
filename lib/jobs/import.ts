import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileInboxForPhones } from '@/lib/inbox/reconcile'
import type { Database, Json } from '@/lib/supabase/types'

type JobInsert = Database['public']['Tables']['jobs']['Insert']
type AdminClient = SupabaseClient<Database>

export interface PreviewRow {
  name: string
  customer: string
  phone: string
  status: string
}

export interface ParsedJob {
  job: Omit<JobInsert, 'company_id'>
  rowIndex: number
  warnings: string[]
}

interface ImportResult {
  count: number
  importedPhones: string[]
}

interface ImportParsedJobsOptions {
  reconcileInbox?: boolean
  batchSize?: number
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function mapHeader(lower: string): keyof JobInsert | 'albi_job_id_src' | null {
  switch (lower) {
    case 'created at': return 'created_at_albi'
    case 'inspection date': return 'inspection_date'
    case 'estimated work start date': return 'estimated_work_start_date'
    case 'file closed': return 'file_closed'
    case 'estimate sent': return 'estimate_sent'
    case 'contract signed': return 'contract_signed'
    case 'coc/cos signed': return 'coc_cos_signed'
    case 'invoiced': return 'invoiced'
    case 'work start': return 'work_start'
    case 'paid': return 'paid'
    case 'estimated completion date': return 'estimated_completion_date'
    case 'link to project': return 'albi_project_url'
    case 'name':
    case 'project name': return 'albi_job_id_src'
    case 'customer':
    case 'customer name': return 'customer_name'
    case 'customer phone number': return 'customer_phone'
    case 'status': return 'status'
    default: return null
  }
}

export function buildRowObjectsFromMatrix(matrix: string[][]): Record<string, string>[] {
  if (matrix.length === 0) return []

  const headers = matrix[0].map((value) => value?.trim() ?? '')
  const rows: Record<string, string>[] = []

  for (const sourceRow of matrix.slice(1)) {
    const row: Record<string, string> = {}
    let hasValues = false

    headers.forEach((header, index) => {
      if (!header) return
      const value = sourceRow[index]?.trim() ?? ''
      if (value) hasValues = true
      row[header] = value
    })

    if (hasValues) rows.push(row)
  }

  return rows
}

export function parseImportedRows(data: Record<string, string>[]) {
  const headerMap = new Map<string, string>()

  for (const row of data) {
    for (const header of Object.keys(row)) {
      const normalized = header.trim().toLowerCase()
      if (!headerMap.has(normalized)) {
        headerMap.set(normalized, header)
      }
    }
  }

  const jobs: ParsedJob[] = []
  const errors: string[] = []

  for (let i = 0; i < data.length; i += 1) {
    const row = data[i]
    const warnings: string[] = []
    const fields: Record<string, string> = {}

    for (const [lower, original] of headerMap) {
      const mapped = mapHeader(lower)
      if (mapped) {
        fields[mapped] = (row[original] ?? '').trim()
      }
    }

    const albiJobId = fields.albi_job_id_src ?? ''
    if (!albiJobId) {
      errors.push(`Row ${i + 2}: missing Name / Project Name — skipped`)
      continue
    }

    const rawPhone = fields.customer_phone ?? ''
    const normalPhone = rawPhone ? normalizePhone(rawPhone) : null
    if (rawPhone && !normalPhone) {
      warnings.push(`Row ${i + 2}: phone "${rawPhone}" could not be normalised`)
    }

    const rawProjectLink = fields.albi_project_url ?? ''
    const projectUrlMatch = rawProjectLink.match(/href=["']([^"']+)["']/)
    const albiProjectUrl = projectUrlMatch ? projectUrlMatch[1] : (rawProjectLink || null)

    const job: Omit<JobInsert, 'company_id'> = {
      albi_job_id: albiJobId,
      customer_name: fields.customer_name || null,
      customer_phone: normalPhone,
      status: fields.status || null,
      created_at_albi: fields.created_at_albi || null,
      inspection_date: fields.inspection_date || null,
      estimated_work_start_date: fields.estimated_work_start_date || null,
      file_closed: fields.file_closed || null,
      estimate_sent: fields.estimate_sent || null,
      contract_signed: fields.contract_signed || null,
      coc_cos_signed: fields.coc_cos_signed || null,
      invoiced: fields.invoiced || null,
      work_start: fields.work_start || null,
      paid: fields.paid || null,
      estimated_completion_date: fields.estimated_completion_date || null,
      albi_project_url: albiProjectUrl,
      raw_csv_row: row as unknown as Json,
    }

    jobs.push({ job, rowIndex: i + 2, warnings })
  }

  const warnings = jobs.flatMap((job) => job.warnings)

  return {
    parsed: jobs,
    rowErrors: [...errors, ...warnings],
    preview: buildPreviewRows(jobs),
  }
}

export function buildPreviewRows(parsed: ParsedJob[]): PreviewRow[] {
  return parsed.slice(0, 5).map(({ job }) => ({
    name: job.albi_job_id,
    customer: job.customer_name ?? '—',
    phone: job.customer_phone ?? '—',
    status: job.status ?? '—',
  }))
}

export async function importParsedJobs(
  supabase: AdminClient,
  companyId: string,
  parsed: ParsedJob[],
  options: ImportParsedJobsOptions = {}
): Promise<ImportResult> {
  const rows: JobInsert[] = parsed.map(({ job }) => ({
    ...job,
    company_id: companyId,
  }))

  const importedPhones = Array.from(
    new Set(rows.map((row) => row.customer_phone).filter((phone): phone is string => Boolean(phone)))
  )

  const batchSize = options.batchSize ?? 500
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize)
    const { error } = await supabase
      .from('jobs')
      .upsert(batch, { onConflict: 'company_id,albi_job_id' })

    if (error) {
      throw new Error(error.message)
    }
  }

  await syncDerivedJobTypes(supabase, companyId, parsed)

  if (options.reconcileInbox !== false) {
    await reconcileInboxForPhones(supabase, companyId, importedPhones)
  }

  return {
    count: rows.length,
    importedPhones,
  }
}

async function syncDerivedJobTypes(
  supabase: AdminClient,
  companyId: string,
  parsed: ParsedJob[]
) {
  const newTypes = new Set<string>()

  for (const { job } of parsed) {
    const parts = job.albi_job_id.split('-')
    if (parts.length >= 3) {
      const code = parts[2].trim().toUpperCase()
      if (code) newTypes.add(code)
    }
  }

  if (newTypes.size === 0) return

  const { data: company, error } = await supabase
    .from('companies')
    .select('job_types')
    .eq('id', companyId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const existing = Array.isArray(company?.job_types)
    ? (company.job_types as Array<{ label: string; substring: string }>)
    : []

  const existingSubstrings = new Set(existing.map((jobType) => jobType.substring.toUpperCase()))
  const merged = [...existing]

  for (const code of newTypes) {
    if (!existingSubstrings.has(code)) {
      merged.push({ label: code, substring: code })
    }
  }

  if (merged.length === existing.length) return

  const { error: updateError } = await supabase
    .from('companies')
    .update({ job_types: merged as unknown as Json })
    .eq('id', companyId)

  if (updateError) {
    throw new Error(updateError.message)
  }
}
