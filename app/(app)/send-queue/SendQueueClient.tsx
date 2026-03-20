'use client'

import { useState, useMemo } from 'react'
import type { SendQueueRow } from './page'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DATE_FIELD_LABELS: Record<string, string> = {
  created_at_albi: 'Created At',
  inspection_date: 'Inspection Date',
  estimated_work_start_date: 'Estimated Work Start Date',
  file_closed: 'File Closed',
  estimate_sent: 'Estimate Sent',
  contract_signed: 'Contract Signed',
  coc_cos_signed: 'COC/COS Signed',
  invoiced: 'Invoiced',
  work_start: 'Work Start',
  paid: 'Paid',
  estimated_completion_date: 'Estimated Completion Date',
}

function formatTrigger(row: SendQueueRow): string {
  const plan = row.plan
  if (!plan) return 'Unknown trigger'
  if (plan.trigger_type === 'date_offset') {
    const fieldLabel =
      DATE_FIELD_LABELS[plan.trigger_date_field ?? ''] ??
      plan.trigger_date_field ??
      'Unknown Date'
    const days = plan.trigger_offset_days ?? 0
    return `${days} day${days !== 1 ? 's' : ''} after ${fieldLabel}`
  }
  return `When status = ${plan.trigger_status_value ?? '?'}`
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  return phone
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialRows: SendQueueRow[]
  companyId: string
}

export default function SendQueueClient({ initialRows, companyId }: Props) {
  const [rows, setRows] = useState<SendQueueRow[]>(initialRows)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterTrigger, setFilterTrigger] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sending, setSending] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<{ queued: number; skipped: number } | null>(null)

  // ── Derived filter options ─────────────────────────────────────────────────

  const triggerOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { label: string; value: string }[] = []
    for (const row of rows) {
      const label = formatTrigger(row)
      if (!seen.has(label)) {
        seen.add(label)
        options.push({ label, value: label })
      }
    }
    return options
  }, [rows])

  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: string[] = []
    for (const row of rows) {
      const s = row.job?.status
      if (s && !seen.has(s)) {
        seen.add(s)
        options.push(s)
      }
    }
    return options
  }, [rows])

  // ── Filtered rows ──────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filterTrigger !== 'all' && formatTrigger(row) !== filterTrigger) return false
      if (filterStatus !== 'all' && row.job?.status !== filterStatus) return false
      return true
    })
  }, [rows, filterTrigger, filterStatus])

  // ── Selection ──────────────────────────────────────────────────────────────

  const allSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id))

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        filteredRows.forEach((r) => next.delete(r.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        filteredRows.forEach((r) => next.add(r.id))
        return next
      })
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = Array.from(selected).filter((id) =>
    filteredRows.some((r) => r.id === id)
  )

  // ── Run scheduler ──────────────────────────────────────────────────────────

  async function handleRunScheduler() {
    setRunning(true)
    setRunResult(null)
    setActionError(null)
    try {
      const res = await fetch('/api/scheduler/run', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? 'Scheduler run failed.')
      } else {
        setRunResult(json)
        // Reload page to pick up newly queued items
        window.location.reload()
      }
    } catch {
      setActionError('Network error while running scheduler.')
    } finally {
      setRunning(false)
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!selectedIds.length) return
    setSending(true)
    setActionError(null)
    try {
      const res = await fetch('/api/send-queue/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? 'Failed to send messages.')
      } else {
        if (json.errors?.length) {
          setActionError(`Sent ${json.sent}, but ${json.errors.length} failed.`)
        }
        // Remove sent rows from local state
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)))
        setSelected(new Set())
      }
    } catch {
      setActionError('Network error while sending.')
    } finally {
      setSending(false)
    }
  }

  // ── Remove ─────────────────────────────────────────────────────────────────

  async function handleRemove() {
    if (!selectedIds.length) return
    setRemoving(true)
    setActionError(null)
    try {
      const res = await fetch('/api/send-queue/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? 'Failed to remove messages.')
      } else {
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)))
        setSelected(new Set())
      }
    } catch {
      setActionError('Network error while removing.')
    } finally {
      setRemoving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Send Queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and approve pending automated messages before they&apos;re sent.
          </p>
        </div>
        <button
          onClick={handleRunScheduler}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          {running ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Scheduler Now
            </>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div>
          <label className="sr-only">Filter by trigger</label>
          <select
            value={filterTrigger}
            onChange={(e) => setFilterTrigger(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All triggers</option>
            {triggerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="sr-only">Filter by job status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All job statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {(filterTrigger !== 'all' || filterStatus !== 'all') && (
          <button
            onClick={() => {
              setFilterTrigger('all')
              setFilterStatus('all')
            }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Action toolbar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleSend}
              disabled={sending || removing}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              {sending ? 'Sending…' : `Send selected (${selectedIds.length})`}
            </button>
            <button
              onClick={handleRemove}
              disabled={sending || removing}
              className="inline-flex items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
            >
              {removing ? 'Removing…' : `Remove selected (${selectedIds.length})`}
            </button>
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {actionError}
        </p>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium text-gray-500">No messages pending.</p>
            <p className="mt-1 text-xs text-gray-400">
              The scheduler will populate this queue overnight.
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Job Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Customer Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Trigger
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Message
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Queued At
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredRows.map((row) => {
                const isExpanded = expandedId === row.id
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-gray-50 transition-colors ${
                      selected.has(row.id) ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={`Select row ${row.id}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {row.job?.customer_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatPhone(row.job?.customer_phone)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs">
                      {formatTrigger(row)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-sm">
                      {isExpanded ? (
                        <span>
                          {row.resolved_message}{' '}
                          <button
                            onClick={() => setExpandedId(null)}
                            className="text-xs text-blue-500 underline ml-1"
                          >
                            show less
                          </button>
                        </span>
                      ) : (
                        <span>
                          {truncate(row.resolved_message, 80)}
                          {row.resolved_message.length > 80 && (
                            <button
                              onClick={() => setExpandedId(row.id)}
                              className="text-xs text-blue-500 underline ml-1"
                            >
                              expand
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {new Date(row.queued_at).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
