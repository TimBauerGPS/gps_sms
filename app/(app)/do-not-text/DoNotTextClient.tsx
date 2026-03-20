'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DoNotText } from '@/lib/supabase/types'

// ─── E.164 normalization ──────────────────────────────────────────────────────

function toE164(raw: string): string | null {
  // Strip everything except digits and a leading +
  const stripped = raw.replace(/[^\d+]/g, '')
  // Already E.164
  if (/^\+1?\d{10}$/.test(stripped)) {
    return stripped.startsWith('+') ? stripped : `+1${stripped}`
  }
  // 10-digit US number
  if (/^\d{10}$/.test(stripped)) return `+1${stripped}`
  // 11-digit starting with 1
  if (/^1\d{10}$/.test(stripped)) return `+${stripped}`
  // Has a + already
  if (/^\+\d{7,15}$/.test(stripped)) return stripped
  return null
}

// ─── Reason badge ─────────────────────────────────────────────────────────────

function ReasonBadge({ reason }: { reason: string | null }) {
  if (reason === 'STOP reply') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        STOP reply
      </span>
    )
  }
  if (reason === 'manual') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
        manual
      </span>
    )
  }
  // Any other reason (e.g. 'legacy import')
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      {reason ?? 'unknown'}
    </span>
  )
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  phoneNumber: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ phoneNumber, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Remove blocked number?</h3>
        <p className="text-sm text-slate-600">
          <span className="font-mono font-medium">{phoneNumber}</span> will be removed from the Do
          Not Text list. This number may receive messages again.
        </p>
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  initialRows: DoNotText[]
  companyId: string
  currentUserId: string
  currentUserEmail: string
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DoNotTextClient({
  initialRows,
  companyId,
  currentUserId,
  currentUserEmail,
}: Props) {
  const supabase = createClient()

  const [rows, setRows] = useState<DoNotText[]>(initialRows)
  const [phone, setPhone] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState('')

  // ── Add number ─────────────────────────────────────────────────────────────

  async function handleAdd() {
    setAddError('')
    const normalized = toE164(phone.trim())
    if (!normalized) {
      setAddError('Enter a valid US phone number (e.g. +17325875238 or 7325875238).')
      return
    }
    if (rows.some((r) => r.phone_number === normalized)) {
      setAddError('This number is already on the list.')
      return
    }
    setAdding(true)
    const { data, error } = await supabase
      .from('do_not_text')
      .insert({
        company_id: companyId,
        phone_number: normalized,
        reason: 'manual',
        added_by: currentUserId,
      })
      .select()
      .single()
    setAdding(false)
    if (error || !data) {
      setAddError(error?.message ?? 'Failed to add number.')
      return
    }
    setRows((prev) => [data, ...prev])
    setPhone('')
  }

  // ── Remove number ──────────────────────────────────────────────────────────

  async function handleConfirmRemove() {
    if (!pendingRemoveId) return
    setRemoveError('')
    const { error } = await supabase.from('do_not_text').delete().eq('id', pendingRemoveId)
    if (error) {
      setRemoveError(error.message)
      setPendingRemoveId(null)
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== pendingRemoveId))
    setPendingRemoveId(null)
  }

  const pendingRow = rows.find((r) => r.id === pendingRemoveId)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {pendingRow && (
        <ConfirmDialog
          phoneNumber={pendingRow.phone_number}
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemoveId(null)}
        />
      )}

      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Do Not Text</h1>
          <p className="text-sm text-slate-500 mt-1">
            Numbers on this list will never receive outbound SMS messages.
          </p>
        </div>

        {/* Add number form */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Block a number</h2>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setAddError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && !adding && handleAdd()}
              placeholder="+17325875238"
              className={
                'flex-1 rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ' +
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
                (addError ? 'border-red-400' : 'border-slate-300')
              }
            />
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {adding ? 'Blocking…' : 'Block Number'}
            </button>
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
        </div>

        {removeError && (
          <p className="text-sm text-red-600">Failed to remove: {removeError}</p>
        )}

        {/* Table */}
        {rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <p className="text-sm text-slate-500">No blocked numbers.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Phone Number
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Reason
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Added At
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Added By
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-900">{row.phone_number}</td>
                    <td className="px-4 py-3">
                      <ReasonBadge reason={row.reason} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(row.added_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.added_by
                        ? row.added_by === currentUserId
                          ? currentUserEmail
                          : row.added_by
                        : 'Auto'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setPendingRemoveId(row.id)}
                        className="text-xs text-slate-400 hover:text-red-600 font-medium transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
