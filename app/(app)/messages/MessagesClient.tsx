'use client'

import { useMemo, useState } from 'react'
import type { MessageRow } from './page'

const PAGE_SIZE = 50

interface Props {
  initialMessages: MessageRow[]
}

type Direction = 'all' | 'outbound' | 'inbound'

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function DirectionBadge({ direction }: { direction: 'outbound' | 'inbound' }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
  if (direction === 'outbound') {
    return <span className={`${base} bg-green-100 text-green-700`}>outbound</span>
  }
  return <span className={`${base} bg-blue-100 text-blue-700`}>inbound</span>
}

function ExpandableBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = body.length > 80
  const display = expanded || !truncated ? body : body.slice(0, 80) + '…'

  return (
    <span>
      {display}
      {truncated && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="ml-1 text-blue-600 hover:underline text-xs"
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      )}
    </span>
  )
}

export default function MessagesClient({ initialMessages }: Props) {
  const [fromDate, setFromDate]       = useState('')
  const [toDate, setToDate]           = useState('')
  const [direction, setDirection]     = useState<Direction>('all')
  const [search, setSearch]           = useState('')
  const [page, setPage]               = useState(0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return initialMessages.filter(msg => {
      // Direction filter
      if (direction !== 'all' && msg.direction !== direction) return false

      // Date range filter
      if (fromDate) {
        const sent = new Date(msg.sent_at)
        const from = new Date(fromDate)
        from.setHours(0, 0, 0, 0)
        if (sent < from) return false
      }
      if (toDate) {
        const sent = new Date(msg.sent_at)
        const to   = new Date(toDate)
        to.setHours(23, 59, 59, 999)
        if (sent > to) return false
      }

      // Search filter (phone or job name)
      if (q) {
        const inPhone   = msg.to_phone.toLowerCase().includes(q) || msg.from_phone.toLowerCase().includes(q)
        const inJobName = (msg.job_name ?? '').toLowerCase().includes(q)
        if (!inPhone && !inJobName) return false
      }

      return true
    })
  }, [initialMessages, fromDate, toDate, direction, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages - 1)
  const paginated  = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  function resetPage() { setPage(0) }

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Sent Messages</h1>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => { setFromDate(e.target.value); resetPage() }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => { setToDate(e.target.value); resetPage() }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Direction toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Direction</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['all', 'outbound', 'inbound'] as Direction[]).map(d => (
              <button
                key={d}
                onClick={() => { setDirection(d); resetPage() }}
                className={[
                  'px-3 py-2 text-sm font-medium capitalize transition-colors',
                  direction === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {d === 'all' ? 'All' : d}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-slate-500">Search</label>
          <input
            type="text"
            placeholder="Phone or job name…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage() }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {paginated.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-20 flex flex-col items-center gap-2">
          <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
          <p className="text-sm text-slate-500 font-medium">No messages yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">Sent At</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">Direction</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">Job Name</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {paginated.map(msg => (
                <tr key={msg.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatDate(msg.sent_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DirectionBadge direction={msg.direction} />
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {msg.job_name ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono whitespace-nowrap">
                    {msg.direction === 'outbound' ? msg.to_phone : msg.from_phone}
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs">
                    <ExpandableBody body={msg.body} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600
                         hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600
                         hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
