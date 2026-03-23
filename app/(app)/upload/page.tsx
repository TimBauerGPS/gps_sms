'use client'

import { useCallback, useRef, useState } from 'react'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

type JobInsert = Database['public']['Tables']['jobs']['Insert']

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}

/** Map a trimmed-lowercase CSV header to a job field name. */
function mapHeader(lower: string): keyof JobInsert | 'albi_job_id_src' | null {
  switch (lower) {
    case 'created at':                   return 'created_at_albi'
    case 'inspection date':              return 'inspection_date'
    case 'estimated work start date':    return 'estimated_work_start_date'
    case 'file closed':                  return 'file_closed'
    case 'estimate sent':                return 'estimate_sent'
    case 'contract signed':              return 'contract_signed'
    case 'coc/cos signed':               return 'coc_cos_signed'
    case 'invoiced':                     return 'invoiced'
    case 'work start':                   return 'work_start'
    case 'paid':                         return 'paid'
    case 'estimated completion date':    return 'estimated_completion_date'
    case 'link to project':              return 'albi_project_url'
    case 'name':
    case 'project name':                 return 'albi_job_id_src'
    case 'customer':
    case 'customer name':                return 'customer_name'
    case 'customer phone number':        return 'customer_phone'
    case 'status':                       return 'status'
    default:                             return null
  }
}

interface PreviewRow {
  name: string
  customer: string
  phone: string
  status: string
}

interface ParsedJob {
  job: Omit<JobInsert, 'company_id'>
  rowIndex: number
  warnings: string[]
}

// ── component ─────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName]     = useState<string | null>(null)
  const [preview, setPreview]       = useState<PreviewRow[]>([])
  const [parsed, setParsed]         = useState<ParsedJob[]>([])
  const [rowErrors, setRowErrors]   = useState<string[]>([])
  const [importing, setImporting]   = useState(false)
  const [result, setResult]         = useState<{ count: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // ── parse CSV ──────────────────────────────────────────────────────────────

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) return
    setFileName(file.name)
    setResult(null)
    setImportError(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, meta }) => {
        const headers: string[] = meta.fields ?? []

        // Build a lookup: normalised header → original header
        const headerMap = new Map<string, string>()
        for (const h of headers) {
          headerMap.set(h.trim().toLowerCase(), h)
        }

        const jobs: ParsedJob[] = []
        const errors: string[]  = []

        for (let i = 0; i < data.length; i++) {
          const row      = data[i]
          const warnings: string[] = []

          // Collect mapped fields
          const fields: Record<string, string> = {}
          for (const [lower, original] of headerMap) {
            const mapped = mapHeader(lower)
            if (mapped) fields[mapped] = (row[original] ?? '').trim()
          }

          // Require a job identifier
          const albiJobId = fields['albi_job_id_src'] ?? ''
          if (!albiJobId) {
            errors.push(`Row ${i + 2}: missing Name / Project Name — skipped`)
            continue
          }

          // Phone normalization
          const rawPhone    = fields['customer_phone'] ?? ''
          const normalPhone = rawPhone ? normalizePhone(rawPhone) : null
          if (rawPhone && !normalPhone) {
            warnings.push(`Row ${i + 2}: phone "${rawPhone}" could not be normalised`)
          }

          // Extract URL from "Link to Project" HTML anchor if present
          const rawProjectLink = fields['albi_project_url'] ?? ''
          const projectUrlMatch = rawProjectLink.match(/href=["']([^"']+)["']/)
          const albiProjectUrl = projectUrlMatch ? projectUrlMatch[1] : (rawProjectLink || null)

          const job: Omit<JobInsert, 'company_id'> = {
            albi_job_id:               albiJobId,
            customer_name:             fields['customer_name']             || null,
            customer_phone:            normalPhone,
            status:                    fields['status']                    || null,
            created_at_albi:           fields['created_at_albi']           || null,
            inspection_date:           fields['inspection_date']           || null,
            estimated_work_start_date: fields['estimated_work_start_date'] || null,
            file_closed:               fields['file_closed']               || null,
            estimate_sent:             fields['estimate_sent']             || null,
            contract_signed:           fields['contract_signed']           || null,
            coc_cos_signed:            fields['coc_cos_signed']            || null,
            invoiced:                  fields['invoiced']                  || null,
            work_start:                fields['work_start']                || null,
            paid:                      fields['paid']                      || null,
            estimated_completion_date: fields['estimated_completion_date'] || null,
            albi_project_url:          albiProjectUrl,
            raw_csv_row:               row as unknown as Record<string, string>,
          }

          jobs.push({ job, rowIndex: i + 2, warnings })
        }

        // Collect all warnings as "errors" for display
        const allWarnings = jobs.flatMap(j => j.warnings)

        setParsed(jobs)
        setRowErrors([...errors, ...allWarnings])
        setPreview(
          jobs.slice(0, 5).map(({ job }) => ({
            name:     job.albi_job_id,
            customer: job.customer_name ?? '—',
            phone:    job.customer_phone ?? '—',
            status:   job.status         ?? '—',
          }))
        )
      },
    })
  }

  // ── drag-and-drop ──────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = () => setIsDragging(false)

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  // ── import ─────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!parsed.length) return
    setImporting(true)
    setImportError(null)
    setResult(null)

    try {
      const supabase = createClient()

      // Get current user's company_id
      const { data: { user }, error: authErr } = await supabase.auth.getUser()
      if (authErr || !user) throw new Error('Not authenticated')

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single()

      if (userErr || !userRow) throw new Error('Could not load user record')

      const company_id = userRow.company_id

      const rows: JobInsert[] = parsed.map(({ job }) => ({
        ...job,
        company_id,
      }))

      // Upsert in batches of 100 to stay within Supabase limits
      const BATCH = 100
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const { error } = await supabase
          .from('jobs')
          .upsert(batch, { onConflict: 'company_id,albi_job_id' })
        if (error) throw new Error(error.message)
      }

      // Auto-fill job types from Name column (format ##-#####-JOBTYPE-OFFICE)
      const newTypes = new Set<string>()
      for (const { job } of parsed) {
        const parts = job.albi_job_id.split('-')
        if (parts.length >= 3) {
          const code = parts[2].trim().toUpperCase()
          if (code) newTypes.add(code)
        }
      }
      if (newTypes.size > 0) {
        // Merge with existing job_types
        const { data: co } = await supabase
          .from('companies')
          .select('job_types')
          .eq('id', company_id)
          .single()
        const existing: Array<{ label: string; substring: string }> =
          Array.isArray(co?.job_types) ? (co!.job_types as Array<{ label: string; substring: string }>) : []
        const existingSubstrings = new Set(existing.map((jt) => jt.substring.toUpperCase()))
        const merged = [...existing]
        for (const code of newTypes) {
          if (!existingSubstrings.has(code)) {
            merged.push({ label: code, substring: code })
          }
        }
        await supabase.from('companies').update({ job_types: merged }).eq('id', company_id)
      }

      setResult({ count: rows.length })
      setParsed([])
      setPreview([])
      setFileName(null)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setImporting(false)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Upload Job Data</h1>

      {/* Drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer select-none',
          'bg-slate-100 py-14 px-6 transition-colors',
          isDragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-slate-400',
        ].join(' ')}
      >
        <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm font-medium text-slate-600">
          {fileName ? fileName : 'Drop CSV file here or click to browse'}
        </p>
        <p className="text-xs text-slate-400">Supports .csv files exported from Albi</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium text-slate-700 mb-2">
            Preview — first {preview.length} of {parsed.length} rows
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {(['Name', 'Customer', 'Phone', 'Status'] as const).map(col => (
                    <th key={col} className="px-4 py-2.5 text-left font-medium text-slate-600 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-800 font-medium">{row.name}</td>
                    <td className="px-4 py-2 text-slate-600">{row.customer}</td>
                    <td className="px-4 py-2 text-slate-600 font-mono">{row.phone}</td>
                    <td className="px-4 py-2 text-slate-600">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row warnings / errors */}
      {rowErrors.length > 0 && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-800 mb-1">Warnings ({rowErrors.length})</p>
          <ul className="list-disc list-inside space-y-0.5">
            {rowErrors.map((e, i) => (
              <li key={i} className="text-xs text-amber-700">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Import button */}
      {parsed.length > 0 && (
        <div className="mt-6">
          <button
            onClick={handleImport}
            disabled={importing || parsed.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importing && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {importing ? 'Importing…' : `Import ${parsed.length} job${parsed.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Result banners */}
      {result && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">
            Imported {result.count} job{result.count !== 1 ? 's' : ''} successfully
          </p>
        </div>
      )}

      {importError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-sm text-red-800 font-medium">{importError}</p>
        </div>
      )}
    </div>
  )
}
