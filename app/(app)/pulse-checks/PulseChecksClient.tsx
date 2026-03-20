'use client'

import { useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Company, Job } from '@/lib/supabase/types'
import PlaceholderPicker from '@/components/PlaceholderPicker'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
  company: Company | null
  distinctStatuses: string[]
}

interface JobRow {
  id: string
  albi_job_id: string
  customer_name: string | null
  customer_phone: string | null
  status: string | null
}

type Step = 1 | 2 | 3

// ─── Helpers ──────────────────────────────────────────────────────────────────

function smsSegments(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 160)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PulseChecksClient({
  companyId,
  distinctStatuses,
}: Props) {
  const supabase = createClient()

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    new Set(distinctStatuses)
  )
  const [jobTypeInput, setJobTypeInput] = useState('')
  const [jobTypeStrings, setJobTypeStrings] = useState<string[]>([])
  const [messageTemplate, setMessageTemplate] = useState('')
  const messageTemplateRef = useRef<HTMLTextAreaElement>(null)

  function insertPlaceholder(text: string) {
    const el = messageTemplateRef.current
    if (!el) {
      setMessageTemplate((v) => v + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = messageTemplate.slice(0, start) + text + messageTemplate.slice(end)
    setMessageTemplate(newVal)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [matchingJobs, setMatchingJobs] = useState<JobRow[]>([])
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // ── Step 3 / send state ───────────────────────────────────────────────────
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{
    sent: number
    skipped: number
  } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const allStatusesSelected = distinctStatuses.every((s) =>
    selectedStatuses.has(s)
  )

  const selectedJobsList = useMemo(
    () => matchingJobs.filter((j) => selectedJobIds.has(j.id)),
    [matchingJobs, selectedJobIds]
  )

  // ── Handlers: Step 1 ──────────────────────────────────────────────────────

  function toggleStatus(status: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  function toggleAllStatuses() {
    if (allStatusesSelected) {
      setSelectedStatuses(new Set())
    } else {
      setSelectedStatuses(new Set(distinctStatuses))
    }
  }

  function handleAddJobTypeTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const tag = jobTypeInput.trim().toUpperCase()
    if (!tag || jobTypeStrings.includes(tag)) {
      setJobTypeInput('')
      return
    }
    setJobTypeStrings((prev) => [...prev, tag])
    setJobTypeInput('')
  }

  function removeJobTypeTag(tag: string) {
    setJobTypeStrings((prev) => prev.filter((t) => t !== tag))
  }

  async function handlePreviewJobs() {
    if (selectedStatuses.size === 0) return
    setLoadingJobs(true)
    setFetchError(null)

    const { data, error } = await supabase
      .from('jobs')
      .select('id, albi_job_id, customer_name, customer_phone, status')
      .eq('company_id', companyId)
      .in('status', Array.from(selectedStatuses))

    setLoadingJobs(false)

    if (error) {
      setFetchError(error.message)
      return
    }

    let jobs = (data ?? []) as JobRow[]

    // Filter by job type strings if any are set
    if (jobTypeStrings.length > 0) {
      jobs = jobs.filter((j) =>
        jobTypeStrings.some((tag) =>
          j.albi_job_id.toUpperCase().includes(tag)
        )
      )
    }

    setMatchingJobs(jobs)
    setSelectedJobIds(new Set(jobs.map((j) => j.id)))
    setStep(2)
  }

  // ── Handlers: Step 2 ──────────────────────────────────────────────────────

  function toggleJob(id: string) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAllJobs() {
    setSelectedJobIds(new Set(matchingJobs.map((j) => j.id)))
  }

  function deselectAllJobs() {
    setSelectedJobIds(new Set())
  }

  // ── Handlers: Step 3 ──────────────────────────────────────────────────────

  async function handleSend() {
    if (selectedJobIds.size === 0) return
    setSending(true)
    setSendError(null)
    setSendResult(null)

    try {
      const res = await fetch('/api/pulse-checks/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_ids: Array.from(selectedJobIds),
          message_template: messageTemplate,
          target_statuses: Array.from(selectedStatuses),
          target_job_type_strings: jobTypeStrings,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }

      setSendResult({ sent: json.sent ?? 0, skipped: json.skipped ?? 0 })
      setStep(1)
      // Reset for fresh use
      setMessageTemplate('')
      setSelectedStatuses(new Set(distinctStatuses))
      setJobTypeStrings([])
      setMatchingJobs([])
      setSelectedJobIds(new Set())
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  // ── Preview message example ───────────────────────────────────────────────

  const previewMessage = useMemo(() => {
    if (!messageTemplate) return ''
    // Simple example substitution for display only
    return messageTemplate
      .replace(/\{\{REVIEW_LINK\}\}/gi, 'https://g.page/r/example')
      .replace(/\{\{([^}]+)\}\}/g, (_, key) => `[${key.trim()}]`)
  }, [messageTemplate])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Pulse Checks</h1>
        <p className="mt-1 text-sm text-gray-500">
          Send a one-off SMS blast to all jobs currently in selected statuses.
        </p>
      </div>

      {/* Success banner */}
      {sendResult && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <svg
            className="w-5 h-5 text-green-500 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">
            Sent to {sendResult.sent} customer
            {sendResult.sent !== 1 ? 's' : ''}.
            {sendResult.skipped > 0
              ? ` Skipped ${sendResult.skipped} (do-not-text or no phone).`
              : ''}
          </p>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={[
                'flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold',
                step === s
                  ? 'bg-blue-600 text-white'
                  : step > s
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-500',
              ].join(' ')}
            >
              {step > s ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s
              )}
            </div>
            <span
              className={`text-sm font-medium ${
                step === s ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              {s === 1 ? 'Configure' : s === 2 ? 'Review Jobs' : 'Confirm & Send'}
            </span>
            {s < 3 && <span className="text-gray-300 mx-1">›</span>}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Configure ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Target Statuses */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-800">
                Target Statuses
              </label>
              <button
                type="button"
                onClick={toggleAllStatuses}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                {allStatusesSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {distinctStatuses.length === 0 ? (
              <p className="text-sm text-gray-400">
                No job statuses found. Upload some jobs first.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {distinctStatuses.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 cursor-pointer rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStatuses.has(status)}
                      onChange={() => toggleStatus(status)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 truncate" title={status}>
                      {status}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Job Type Filter */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Job Type Filter{' '}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Leave empty to include all job types.
            </p>

            {jobTypeStrings.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {jobTypeStrings.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeJobTypeTag(tag)}
                      className="ml-0.5 text-blue-500 hover:text-blue-700"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              type="text"
              value={jobTypeInput}
              onChange={(e) => setJobTypeInput(e.target.value)}
              onKeyDown={handleAddJobTypeTag}
              placeholder='e.g. "RBL" then press Enter'
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1.5 text-xs text-gray-400">
              Press Enter to add a tag. Matches jobs whose name contains the tag.
            </p>
          </div>

          {/* Message Template */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Message Template
            </label>
            <textarea
              ref={messageTemplateRef}
              rows={5}
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              placeholder={`Hi {{Customer Name}}, just checking in on your job. If you're happy with our service, we'd love a review: {{REVIEW_LINK}}`}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <PlaceholderPicker onInsert={insertPlaceholder} />
              <span className="text-xs text-gray-400 shrink-0 ml-2">
                {messageTemplate.length} chars · {smsSegments(messageTemplate)} segment
                {smsSegments(messageTemplate) !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* CTA */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePreviewJobs}
              disabled={
                selectedStatuses.size === 0 ||
                !messageTemplate.trim() ||
                loadingJobs
              }
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loadingJobs && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              Preview Matching Jobs
            </button>
          </div>

          {fetchError && (
            <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {fetchError}
            </p>
          )}
        </div>
      )}

      {/* ── STEP 2: Review Jobs ────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                {selectedJobIds.size}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-gray-900">
                {matchingJobs.length}
              </span>{' '}
              job{matchingJobs.length !== 1 ? 's' : ''} selected
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={selectAllJobs}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={deselectAllJobs}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Deselect all
              </button>
            </div>
          </div>

          {matchingJobs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white py-16 flex flex-col items-center gap-2">
              <p className="text-sm text-gray-400 font-medium">
                No jobs match the selected filters.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-8">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Job Name
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Customer
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Phone
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {matchingJobs.map((job) => (
                    <tr
                      key={job.id}
                      className={[
                        'hover:bg-gray-50 transition-colors cursor-pointer',
                        !selectedJobIds.has(job.id) ? 'opacity-50' : '',
                      ].join(' ')}
                      onClick={() => toggleJob(job.id)}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedJobIds.has(job.id)}
                          onChange={() => toggleJob(job.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {job.albi_job_id}
                      </td>
                      <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                        {job.customer_name ?? (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-600 font-mono whitespace-nowrap">
                        {job.customer_phone ?? (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                        {job.status ?? <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={selectedJobIds.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Review Message →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Confirm & Send ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              Message Preview
            </h2>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
              {previewMessage || (
                <span className="text-gray-400 italic">(empty message)</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Placeholders shown as{' '}
              <code className="rounded bg-gray-100 px-1 font-mono">[name]</code>.
              Actual values will be substituted per job at send time.
            </p>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-900">
              Sending to{' '}
              <span className="text-blue-700">{selectedJobIds.size}</span>{' '}
              customer{selectedJobIds.size !== 1 ? 's' : ''}
            </p>
            <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
              {selectedJobsList.map((j) => (
                <li key={j.id} className="text-xs text-blue-700">
                  {j.albi_job_id}
                  {j.customer_name ? ` — ${j.customer_name}` : ''}
                  {j.customer_phone ? ` (${j.customer_phone})` : ''}
                </li>
              ))}
            </ul>
          </div>

          {sendError && (
            <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {sendError}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={sending}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              ← Back
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={sending}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || selectedJobIds.size === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-7 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Sending…
                  </>
                ) : (
                  'Send Now'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
