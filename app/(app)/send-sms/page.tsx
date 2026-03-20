'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Job } from '@/lib/supabase/types'
import PlaceholderPicker from '@/components/PlaceholderPicker'

// ─── Types ────────────────────────────────────────────────────────────────────

type JobSearchResult = Pick<
  Job,
  'id' | 'albi_job_id' | 'customer_name' | 'customer_phone'
>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function smsSegments(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 160)
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SendSmsPage() {
  const supabase = createClient()

  // Job search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<JobSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<JobSearchResult | null>(null)
  const [manualPhone, setManualPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')

  // Send state
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{
    success: boolean
    sid?: string
  } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const searchRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const debouncedQuery = useDebounce(searchQuery, 300)

  function insertPlaceholder(text: string) {
    const el = messageRef.current
    if (!el) {
      setMessage((v) => v + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = message.slice(0, start) + text + message.slice(end)
    setMessage(newVal)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounced job search
  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults([])
        setDropdownOpen(false)
        return
      }

      setSearchLoading(true)
      const pattern = `%${q.trim()}%`

      const { data } = await supabase
        .from('jobs')
        .select('id, albi_job_id, customer_name, customer_phone')
        .or(`albi_job_id.ilike.${pattern},customer_name.ilike.${pattern}`)
        .limit(10)

      setSearchLoading(false)
      setSearchResults((data ?? []) as JobSearchResult[])
      setDropdownOpen(true)
    },
    [supabase]
  )

  useEffect(() => {
    runSearch(debouncedQuery)
  }, [debouncedQuery, runSearch])

  function selectJob(job: JobSearchResult) {
    setSelectedJob(job)
    setPhone(job.customer_phone ?? '')
    setSearchQuery(job.albi_job_id)
    setDropdownOpen(false)
  }

  function clearJob() {
    setSelectedJob(null)
    setSearchQuery('')
    setPhone('')
    setSearchResults([])
  }

  function toggleManualPhone() {
    setManualPhone((v) => !v)
    if (!manualPhone) {
      // Switching to manual — clear job selection
      clearJob()
    }
  }

  const effectivePhone = manualPhone ? phone : (selectedJob?.customer_phone ?? '')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!effectivePhone.trim() || !message.trim()) return

    setSending(true)
    setSendError(null)
    setSendResult(null)

    try {
      const res = await fetch('/api/send-sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: selectedJob?.id ?? undefined,
          phone: effectivePhone.trim(),
          message: message.trim(),
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }

      setSendResult({ success: true, sid: json.sid })
      setMessage('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  const segments = smsSegments(message)

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Send SMS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Send a one-time manual SMS to a customer.
        </p>
      </div>

      {/* Success banner */}
      {sendResult?.success && (
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
          <div>
            <p className="text-sm text-green-800 font-medium">Message sent!</p>
            {sendResult.sid && (
              <p className="text-xs text-green-600 font-mono mt-0.5">
                SID: {sendResult.sid}
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-5">
        {/* Job Search / Manual toggle */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-800">
              {manualPhone ? 'Phone Number (manual)' : 'Search Job'}
            </label>
            <button
              type="button"
              onClick={toggleManualPhone}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              {manualPhone ? 'Search by job instead' : 'Enter phone manually'}
            </button>
          </div>

          {!manualPhone ? (
            /* Job search */
            <div ref={searchRef} className="relative">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    if (selectedJob && e.target.value !== selectedJob.albi_job_id) {
                      clearJob()
                    }
                  }}
                  placeholder="Search by job name or customer name…"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoComplete="off"
                />
                {searchLoading && (
                  <svg
                    className="absolute right-2.5 top-2.5 w-4 h-4 animate-spin text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                )}
              </div>

              {/* Dropdown */}
              {dropdownOpen && searchResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden text-sm">
                  {searchResults.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        onMouseDown={() => selectJob(job)}
                        className="w-full px-3 py-2.5 text-left hover:bg-blue-50 transition-colors"
                      >
                        <span className="font-medium text-gray-900">
                          {job.albi_job_id}
                        </span>
                        {job.customer_name && (
                          <span className="ml-2 text-gray-500">
                            — {job.customer_name}
                          </span>
                        )}
                        {job.customer_phone && (
                          <span className="ml-2 font-mono text-gray-400">
                            {job.customer_phone}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {dropdownOpen &&
                searchQuery.trim() &&
                !searchLoading &&
                searchResults.length === 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg px-3 py-3 text-sm text-gray-400">
                    No jobs found.
                  </div>
                )}
            </div>
          ) : (
            /* Manual phone entry */
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}

          {/* Phone display when job selected */}
          {!manualPhone && selectedJob && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Phone Number
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 font-mono">
                  {selectedJob.customer_phone ?? (
                    <span className="text-gray-400 font-sans">No phone on record</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearJob}
                  className="text-xs text-gray-400 hover:text-gray-600"
                  aria-label="Clear selected job"
                >
                  ✕
                </button>
              </div>
              {selectedJob.customer_name && (
                <p className="mt-1 text-xs text-gray-500">
                  Customer: {selectedJob.customer_name}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Message */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Message
          </label>
          <textarea
            ref={messageRef}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              selectedJob
                ? `Hi {{Customer Name}}, this is a message about your job {{Name}}. {{REVIEW_LINK}}`
                : 'Type your message…'
            }
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <PlaceholderPicker onInsert={insertPlaceholder} />
            <span
              className={[
                'text-xs shrink-0 ml-2 font-mono',
                message.length > 160 ? 'text-amber-500' : 'text-gray-400',
              ].join(' ')}
            >
              {message.length} / 160 · {segments} segment
              {segments !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Error */}
        {sendError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <svg
              className="w-4 h-4 text-red-500 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <p className="text-sm text-red-700">{sendError}</p>
          </div>
        )}

        {/* Send button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              sending ||
              !message.trim() ||
              (!manualPhone
                ? !selectedJob?.customer_phone
                : !phone.trim())
            }
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-7 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
