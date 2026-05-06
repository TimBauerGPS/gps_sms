'use client'

import { useMemo, useState } from 'react'

interface AppUser {
  id: string
  company_id: string | null
  email: string
  role: 'admin' | 'member'
  has_app_access: boolean
  companies?: { name: string } | null
}

interface Company {
  id: string
  name: string
}

interface Props {
  users: AppUser[]
  companies: Company[]
}

export default function UsersClient({ users: initialUsers, companies }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [companyOptions, setCompanyOptions] = useState(companies)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteCompanyId, setInviteCompanyId] = useState(companies[0]?.id ?? '')
  const [newCompanyName, setNewCompanyName] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isAddingCompany = inviteCompanyId === '__new__'

  const companyById = useMemo(() => {
    return new Map(companyOptions.map((company) => [company.id, company]))
  }, [companyOptions])

  async function inviteUser() {
    setInviting(true)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          companyId: isAddingCompany ? undefined : inviteCompanyId,
          companyName: isAddingCompany ? newCompanyName : undefined,
          role: inviteRole,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to invite user')
        return
      }

      const invitedCompany: Company | undefined = json.company
      if (invitedCompany) {
        setCompanyOptions((prev) => {
          if (prev.some((company) => company.id === invitedCompany.id)) return prev
          return [...prev, invitedCompany].sort((a, b) => a.name.localeCompare(b.name))
        })
      }

      const company = invitedCompany ?? companyById.get(inviteCompanyId)
      const companyId = company?.id ?? inviteCompanyId
      setUsers((prev) => {
        const existing = prev.find((user) => user.id === json.userId)
        const nextUser: AppUser = {
          id: json.userId,
          email: inviteEmail.trim().toLowerCase(),
          company_id: companyId,
          role: inviteRole,
          has_app_access: true,
          companies: company ? { name: company.name } : null,
        }

        return existing
          ? prev.map((user) => (user.id === json.userId ? nextUser : user))
          : [...prev, nextUser].sort((a, b) => a.email.localeCompare(b.email))
      })

      setInviteEmail('')
      setNewCompanyName('')
      if (isAddingCompany && company?.id) setInviteCompanyId(company.id)
      setMessage('Invite saved. New users receive an invite; existing shared-login users receive an access email.')
    } catch {
      setError('Network error')
    } finally {
      setInviting(false)
    }
  }

  async function updateUser(userId: string, updates: { companyId?: string; role?: 'admin' | 'member' }) {
    setSavingUserId(userId)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to update user')
        return
      }

      setUsers((prev) =>
        prev.map((user) => {
          if (user.id !== userId) return user
          const nextCompanyId = updates.companyId ?? user.company_id
          const company = nextCompanyId ? companyById.get(nextCompanyId) : null
          return {
            ...user,
            company_id: nextCompanyId,
            role: updates.role ?? user.role,
            has_app_access: true,
            companies: company ? { name: company.name } : user.companies,
          }
        })
      )
      setMessage('User updated.')
    } catch {
      setError('Network error')
    } finally {
      setSavingUserId(null)
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">
          Invite shared-login users and assign their Guardian SMS company.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_180px_140px_auto] md:items-end">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Company</label>
            <select
              value={inviteCompanyId}
              onChange={(event) => setInviteCompanyId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
              <option value="__new__">Add new company...</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">New company</label>
            <input
              type="text"
              value={newCompanyName}
              onChange={(event) => setNewCompanyName(event.target.value)}
              disabled={!isAddingCompany}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
              placeholder="Company name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={inviteUser}
            disabled={inviting || !inviteEmail.trim() || (isAddingCompany ? !newCompanyName.trim() : !inviteCompanyId)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {inviting ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      </div>

      {(message || error) && (
        <div className={`rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {error ?? message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-900">{user.email}</td>
                <td className="px-5 py-3">
                  <select
                    value={user.company_id ?? ''}
                    onChange={(event) => updateUser(user.id, { companyId: event.target.value })}
                    disabled={savingUserId === user.id}
                    className="w-full min-w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="" disabled>Choose company</option>
                    {companyOptions.map((company) => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <select
                    value={user.role}
                    onChange={(event) => updateUser(user.id, { role: event.target.value as 'admin' | 'member' })}
                    disabled={savingUserId === user.id}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${user.has_app_access ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                    {user.has_app_access ? 'Guardian SMS' : 'Shared login'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
