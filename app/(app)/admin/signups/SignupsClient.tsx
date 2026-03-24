'use client'

import { useState } from 'react'

interface SignupRequest {
  id: string
  name: string
  email: string
  requested_company_name: string
  status: 'pending' | 'approved' | 'rejected'
  company_id: string | null
  created_at: string
}

interface Company {
  id: string
  name: string
}

interface Props {
  requests: SignupRequest[]
  companies: Company[]
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  )
}

function ApproveModal({
  request,
  companies,
  onClose,
  onApproved,
}: {
  request: SignupRequest
  companies: Company[]
  onClose: () => void
  onApproved: (id: string) => void
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [companyName, setCompanyName] = useState(request.requested_company_name)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      const body =
        mode === 'existing'
          ? { requestId: request.id, companyId: selectedCompanyId, companyName }
          : { requestId: request.id, companyName }

      const res = await fetch('/api/admin/approve-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to approve'); return }
      onApproved(request.id)
      onClose()
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Approve Request</h2>
          <p className="text-sm text-slate-500 mt-1">
            <strong>{request.name}</strong> ({request.email}) will be approved. Use the <strong>Set Password</strong> button afterward to send them their login credentials.
          </p>
        </div>

        {/* Company mode toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
          <button
            onClick={() => setMode('new')}
            className={`flex-1 py-2 transition-colors ${mode === 'new' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Create new company
          </button>
          <button
            onClick={() => setMode('existing')}
            className={`flex-1 py-2 transition-colors ${mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Add to existing
          </button>
        </div>

        {mode === 'new' ? (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Requested: &ldquo;{request.requested_company_name}&rdquo;</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Select company</label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— choose —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rename company (optional)</label>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Leave blank to keep current name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={loading || (mode === 'existing' && !selectedCompanyId)}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Approving…' : 'Approve & Send Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SetPasswordModal({ request, onClose }: { request: SignupRequest; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ password: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSetPassword() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: request.email }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed'); return }
      setResult({ password: json.password })
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  function copyPassword() {
    if (!result) return
    try {
      navigator.clipboard.writeText(result.password)
    } catch {
      const el = document.createElement('textarea')
      el.value = result.password
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Set Temporary Password</h2>
          <p className="text-sm text-slate-500 mt-1">{request.name} ({request.email})</p>
        </div>

        {!result ? (
          <>
            <p className="text-sm text-slate-600">
              A secure temporary password will be generated and set for this user. Share it with them directly — they can change it in Settings after logging in.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
              <button
                onClick={handleSetPassword}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Generating…' : 'Generate & Set Password'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500 mb-1">Temporary password for {request.email}</p>
              <div className="flex items-center gap-3">
                <code className="text-lg font-mono font-semibold text-slate-900 tracking-wider">{result.password}</code>
                <button
                  onClick={copyPassword}
                  className="text-xs px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">Send this to the user. They can change it in Settings → Change Password after logging in.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 transition-colors">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function SignupsClient({ requests: initialRequests, companies }: Props) {
  const [requests, setRequests] = useState(initialRequests)
  const [approving, setApproving] = useState<SignupRequest | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [settingPassword, setSettingPassword] = useState<SignupRequest | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')

  const filtered = requests.filter((r) => filter === 'all' || r.status === filter)
  const pendingCount = requests.filter((r) => r.status === 'pending').length

  function handleApproved(id: string) {
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
  }

  async function handleReject(id: string) {
    setRejecting(id)
    try {
      await fetch('/api/admin/reject-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id }),
      })
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'rejected' } : r))
    } finally {
      setRejecting(null)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Signup Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            {pendingCount} pending request{pendingCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${filter === f ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-slate-500">No {filter === 'all' ? '' : filter} requests.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Company Requested</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-sm font-medium text-slate-900">{r.name}</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{r.email}</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{r.requested_company_name}</td>
                  <td className="px-5 py-3 text-sm text-slate-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => setApproving(r)}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(r.id)}
                            disabled={rejecting === r.id}
                            className="px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            {rejecting === r.id ? '…' : 'Reject'}
                          </button>
                        </>
                      )}
                      {r.status === 'approved' && (
                        <button
                          onClick={() => setSettingPassword(r)}
                          className="px-3 py-1.5 border border-blue-300 text-blue-600 text-xs font-medium rounded-md hover:bg-blue-50 transition-colors"
                        >
                          Set Password
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving && (
        <ApproveModal
          request={approving}
          companies={companies}
          onClose={() => setApproving(null)}
          onApproved={handleApproved}
        />
      )}
      {settingPassword && (
        <SetPasswordModal
          request={settingPassword}
          onClose={() => setSettingPassword(null)}
        />
      )}
    </div>
  )
}
