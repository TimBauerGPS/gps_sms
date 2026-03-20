'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase sets the session from the URL hash after invite/recovery
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
      else {
        // Wait briefly for the session to be set from hash
        setTimeout(async () => {
          const { data: d2 } = await supabase.auth.getSession()
          if (d2.session) setReady(true)
          else setError('Invalid or expired link. Please request a new one.')
        }, 1000)
      }
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { setError(err.message); setLoading(false); return }
    router.push('/upload')
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">Guardian SMS</h1>
          <p className="mt-1 text-sm text-slate-400">Set your password</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
          {error && !ready ? (
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-red-400">{error}</p>
              <a href="/login" className="text-xs text-blue-400 hover:text-blue-300 underline">Back to sign in</a>
            </div>
          ) : !ready ? (
            <p className="text-sm text-slate-400 text-center py-4">Verifying link…</p>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">New password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="Repeat password"
                />
              </div>
              {error && (
                <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-3.5 py-2.5">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Saving…' : 'Set password & sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
