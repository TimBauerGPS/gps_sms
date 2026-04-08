'use client'

import { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import {
  importParsedJobs,
  parseImportedRows,
  type ParsedJob,
  type PreviewRow,
} from '@/lib/jobs/import'

const ALLIED_COMPANY_NAME = 'Allied Restoration Services'

interface CompanyImportSettings {
  id: string
  name: string
  google_sheet_url: string | null
  google_sheet_last_imported_at: string | null
}

interface GoogleSheetTestResult {
  spreadsheetTitle: string
  worksheetTitle: string
  headerCount: number
  headers: string[]
  totalRows: number
  preview: PreviewRow[]
  warningCount: number
}

export default function UploadPage() {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [parsed, setParsed] = useState<ParsedJob[]>([])
  const [rowErrors, setRowErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ count: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [company, setCompany] = useState<CompanyImportSettings | null>(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [testingSheet, setTestingSheet] = useState(false)
  const [importingSheet, setImportingSheet] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [sheetSuccess, setSheetSuccess] = useState<string | null>(null)
  const [sheetTestResult, setSheetTestResult] = useState<GoogleSheetTestResult | null>(null)

  useEffect(() => {
    let active = true

    async function loadCompany() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !active) return

      const { data: userRow } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single()

      if (!userRow || !active) return

      const { data: companyRow } = await supabase
        .from('companies')
        .select('id, name, google_sheet_url, google_sheet_last_imported_at')
        .eq('id', userRow.company_id)
        .single()

      if (!companyRow || !active) return

      setCompany(companyRow)
      setSheetUrl(companyRow.google_sheet_url ?? '')
    }

    void loadCompany()

    return () => {
      active = false
    }
  }, [supabase])

  function processRows(fileLabel: string, rows: Record<string, string>[]) {
    const parsedResult = parseImportedRows(rows)
    setFileName(fileLabel)
    setResult(null)
    setImportError(null)
    setParsed(parsedResult.parsed)
    setRowErrors(parsedResult.rowErrors)
    setPreview(parsedResult.preview)
  }

  function triggerInboxReconciliation(phones: string[]) {
    if (phones.length === 0) return

    void fetch('/api/inbox/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones }),
      keepalive: true,
    }).catch((error) => {
      console.warn('[upload] Inbox reconciliation did not complete:', error)
    })
  }

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) return

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => processRows(file.name, data),
      error: (error) => setImportError(error.message),
    })
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = () => setIsDragging(false)

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) processFile(file)
  }

  async function handleImport() {
    if (!parsed.length || !company) return
    setImporting(true)
    setImportError(null)
    setResult(null)

    try {
      const importResult = await importParsedJobs(supabase, company.id, parsed, {
        reconcileInbox: false,
      })
      triggerInboxReconciliation(importResult.importedPhones)
      setResult({ count: importResult.count })
      setParsed([])
      setPreview([])
      setFileName(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setImporting(false)
    }
  }

  async function handleSheetTest() {
    if (!sheetUrl.trim()) return

    setTestingSheet(true)
    setSheetError(null)
    setSheetSuccess(null)

    try {
      const response = await fetch('/api/upload/google-sheet/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl }),
      })

      const data = await parseJsonResponse<GoogleSheetTestResult & { error?: string }>(response)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to test Google Sheet.')
      }

      setSheetTestResult(data)
      setSheetSuccess(`Connected to ${data.spreadsheetTitle} → ${data.worksheetTitle}.`)
      setCompany((current) => current ? { ...current, google_sheet_url: sheetUrl.trim() } : current)
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : 'Failed to test Google Sheet.')
    } finally {
      setTestingSheet(false)
    }
  }

  async function handleSheetImport() {
    if (!sheetUrl.trim()) return

    setImportingSheet(true)
    setSheetError(null)
    setSheetSuccess(null)
    setResult(null)
    setImportError(null)

    try {
      const response = await fetch('/api/upload/google-sheet/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl }),
      })

      const data = await parseJsonResponse<{
        count?: number
        spreadsheetTitle?: string
        worksheetTitle?: string
        warningCount?: number
        error?: string
      }>(response)

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import Google Sheet.')
      }

      setResult({ count: data.count ?? 0 })
      setSheetSuccess(
        `Imported ${data.count ?? 0} job${data.count === 1 ? '' : 's'} from ${data.spreadsheetTitle} → ${data.worksheetTitle}.`
      )
      setCompany((current) =>
        current
          ? {
              ...current,
              google_sheet_url: sheetUrl.trim(),
              google_sheet_last_imported_at: new Date().toISOString(),
            }
          : current
      )
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : 'Failed to import Google Sheet.')
    } finally {
      setImportingSheet(false)
    }
  }

  const isAlliedCompany = company?.name === ALLIED_COMPANY_NAME
  const lastSheetImport = company?.google_sheet_last_imported_at
    ? new Date(company.google_sheet_last_imported_at).toLocaleString()
    : null

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Upload Job Data</h1>
        <p className="text-sm text-slate-500">
          Import the latest Albi export as a CSV. Allied Restoration Services can also sync directly from a shared Google Sheet.
        </p>
      </div>

      {isAlliedCompany && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-1 mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Google Sheets Import</h2>
            <p className="text-sm text-slate-500">
              Paste the shared sheet link here, test that the service account can read it, then import it on demand. After a successful import, it will sync automatically each day around 8:00 PM Pacific.
            </p>
          </div>

          <label htmlFor="sheet-url" className="block text-sm font-medium text-slate-700 mb-2">
            Google Sheets link
          </label>
          <input
            id="sheet-url"
            type="url"
            value={sheetUrl}
            onChange={(event) => setSheetUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleSheetTest}
              disabled={testingSheet || importingSheet || !sheetUrl.trim()}
              className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testingSheet ? 'Testing…' : 'Test'}
            </button>
            <button
              onClick={handleSheetImport}
              disabled={testingSheet || importingSheet || !sheetUrl.trim()}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importingSheet ? 'Importing…' : 'Import from Google Sheet'}
            </button>
            {lastSheetImport && (
              <p className="text-xs text-slate-500">Last automated/manual sheet import: {lastSheetImport}</p>
            )}
          </div>

          {sheetSuccess && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {sheetSuccess}
            </div>
          )}

          {sheetError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {sheetError}
            </div>
          )}

          {sheetTestResult && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-800">
                {sheetTestResult.spreadsheetTitle} → {sheetTestResult.worksheetTitle}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {sheetTestResult.totalRows} data row{sheetTestResult.totalRows === 1 ? '' : 's'} detected, {sheetTestResult.headerCount} header{sheetTestResult.headerCount === 1 ? '' : 's'}, {sheetTestResult.warningCount} warning{sheetTestResult.warningCount === 1 ? '' : 's'}.
              </p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Headers</p>
              <p className="mt-1 text-sm text-slate-700">{sheetTestResult.headers.join(', ') || 'No headers found'}</p>

              {sheetTestResult.preview.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {(['Name', 'Customer', 'Phone', 'Status'] as const).map((column) => (
                          <th key={column} className="px-4 py-2.5 text-left font-medium text-slate-600 whitespace-nowrap">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {sheetTestResult.preview.map((row, index) => (
                        <tr key={`${row.name}-${index}`}>
                          <td className="px-4 py-2 text-slate-800 font-medium">{row.name}</td>
                          <td className="px-4 py-2 text-slate-600">{row.customer}</td>
                          <td className="px-4 py-2 text-slate-600 font-mono">{row.phone}</td>
                          <td className="px-4 py-2 text-slate-600">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-6">
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

        {preview.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">
              Preview — first {preview.length} of {parsed.length} rows
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {(['Name', 'Customer', 'Phone', 'Status'] as const).map((column) => (
                      <th key={column} className="px-4 py-2.5 text-left font-medium text-slate-600 whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {preview.map((row, index) => (
                    <tr key={`${row.name}-${index}`} className="hover:bg-slate-50">
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

        {rowErrors.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
            <p className="text-sm font-medium text-amber-800 mb-1">Warnings ({rowErrors.length})</p>
            <ul className="list-disc list-inside space-y-0.5">
              {rowErrors.map((message, index) => (
                <li key={`${message}-${index}`} className="text-xs text-amber-700">{message}</li>
              ))}
            </ul>
          </div>
        )}

        {parsed.length > 0 && (
          <div>
            <button
              onClick={handleImport}
              disabled={importing || parsed.length === 0 || !company}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

        {result && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-green-800 font-medium">
              Imported {result.count} job{result.count !== 1 ? 's' : ''} successfully
            </p>
          </div>
        )}

        {importError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <p className="text-sm text-red-800 font-medium">{importError}</p>
          </div>
        )}
      </section>
    </div>
  )
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text.startsWith('<') ? 'The server timed out before the import finished. Please try again.' : text)
  }
}
